// Paged reads for PostgREST.
//
// Supabase caps a single response at `db-max-rows` (1,000 on this project).
// The dashboard previously issued unpaged queries and used `.length` on the
// result, so any set larger than the cap was silently truncated and the
// displayed number was quietly wrong. Everything that can exceed the cap now
// goes through here.
//
// Errors are logged and the rows gathered so far are returned, matching the
// original surfaces' resilience (they destructured only `data`, so a failed
// query rendered as zero rather than crashing the page). A truncated read is
// always logged — it is never silent.

export const PAGE_SIZE = 1000;

/** Backstop against an unbounded loop; 200 pages = 200k rows. */
export const MAX_PAGES = 200;

interface PageResult<T> {
  data: T[] | null;
  error: { message: string } | null;
}

/**
 * Read every row of a query by walking `.range()` windows.
 *
 * @param label   Identifier used in warnings.
 * @param page    Builds the query for one window; receives inclusive bounds.
 * @param stopWhen Optional early exit, evaluated after each page. Use when the
 *                 rows are ordered such that a prefix is already sufficient.
 */
export async function fetchAllRows<T>(
  label: string,
  page: (from: number, to: number) => PromiseLike<PageResult<T>>,
  stopWhen?: (rows: T[]) => boolean
): Promise<T[]> {
  const out: T[] = [];

  for (let i = 0; i < MAX_PAGES; i++) {
    const from = i * PAGE_SIZE;
    const { data, error } = await page(from, from + PAGE_SIZE - 1);

    if (error) {
      console.error(
        `[dashboard] ${label}: page ${i} failed (${error.message}) — returning ${out.length} row(s) gathered so far`
      );
      return out;
    }

    const rows = data ?? [];
    out.push(...rows);

    if (rows.length < PAGE_SIZE) return out;
    if (stopWhen?.(out)) return out;
  }

  console.error(
    `[dashboard] ${label}: reached MAX_PAGES (${MAX_PAGES}) after ${out.length} rows — result may be incomplete`
  );
  return out;
}

/**
 * Read every row by asking for the exact count first, then fetching all pages
 * CONCURRENTLY.
 *
 * `fetchAllRows` walks pages one at a time because it cannot know where the
 * data ends. For a wide window that means N sequential round trips. When the
 * row count can be obtained cheaply with a `head` request, this issues the
 * pages in parallel instead, so latency is two round trips rather than N.
 *
 * Falls back to the sequential walk if the count is unavailable.
 */
export async function fetchAllRowsCounted<T>(
  label: string,
  count: () => PromiseLike<{ count: number | null; error: { message: string } | null }>,
  page: (from: number, to: number) => PromiseLike<PageResult<T>>
): Promise<T[]> {
  const { count: total, error } = await count();

  if (error || total == null) {
    if (error) console.error(`[dashboard] ${label}: count failed (${error.message}) — paging sequentially`);
    return fetchAllRows(label, page);
  }
  if (total === 0) return [];

  const pages = Math.min(Math.ceil(total / PAGE_SIZE), MAX_PAGES);
  if (pages >= MAX_PAGES) {
    console.error(`[dashboard] ${label}: ${total} rows exceeds MAX_PAGES (${MAX_PAGES}) — result may be incomplete`);
  }

  const results = await Promise.all(
    Array.from({ length: pages }, (_, i) =>
      Promise.resolve(page(i * PAGE_SIZE, i * PAGE_SIZE + PAGE_SIZE - 1)).then((r) => {
        if (r.error) {
          console.error(`[dashboard] ${label}: page ${i} failed (${r.error.message})`);
          return [] as T[];
        }
        return r.data ?? [];
      })
    )
  );

  return results.flat();
}

/** Split `ids` into chunks small enough for a PostgREST `in.(…)` filter. */
export function chunk<T>(ids: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < ids.length; i += size) out.push(ids.slice(i, i + size));
  return out;
}
