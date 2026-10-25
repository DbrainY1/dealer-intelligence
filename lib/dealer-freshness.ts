// Set-based resolution of each dealer's Last Captured Date (LCD) and the
// snapshot rows for the selected freshness cohort.
//
// Query shape is bounded by the roster and by the number of DISTINCT capture
// dates in the freshness window — never by dealer count and never by inventory
// size. Nothing here issues one query per dealer.
//
//   1 : newest snapshot_date in the market
//   P : pages of rows on that date            (P = ceil(rows / 1000))
//   1 : page(s) of recent dates for dealers absent from the newest date
//   D : one paged read per distinct older LCD still inside the window
//       (D is 0 whenever every in-scope dealer captured on the newest date)
//
// Every read is paged through fetchAllRows, so nothing truncates at the
// PostgREST 1,000-row cap.

import { fetchAllRows } from "./fetch-all.ts";
import {
  STALE_MAX_DAYS,
  calendarDaysBetween,
  freshnessFor,
  isInScope,
  lcdAgeDays,
  type Freshness,
  type MarketScope,
} from "./freshness.ts";

/** Minimal PostgREST surface used here. */
export interface SupabaseLike {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  from(table: string): any;
}

export interface SnapshotMetricRow {
  dealer_id: number;
  list_price: number | null;
}

export interface DealerCapture {
  dealerId: number;
  /** Most recent snapshot_date with rows, or null if the dealer never captured. */
  lcd: string | null;
  ageDays: number | null;
  freshness: Freshness;
  inScope: boolean;
}

/** Shift a YYYY-MM-DD date by whole days, anchored at UTC noon (DST-safe). */
export function shiftDate(date: string, days: number): string {
  const t = Date.UTC(
    Number(date.slice(0, 4)),
    Number(date.slice(5, 7)) - 1,
    Number(date.slice(8, 10)),
    12
  );
  return new Date(t + days * 86_400_000).toISOString().slice(0, 10);
}

/**
 * Resolve LCD + freshness for every dealer in `dealerIds`.
 *
 * Dealers with no capture inside the freshness window are reported as
 * `historic` with `lcd: null`. That is deliberately "unknown but older than
 * the window", not "zero inventory" — callers must never read it as a sale,
 * a disappearance, or an empty lot.
 */
export async function resolveDealerCaptures(
  supabase: SupabaseLike,
  dealerIds: number[],
  todayPacific: string,
  scope: MarketScope
): Promise<Map<number, DealerCapture>> {
  const out = new Map<number, DealerCapture>();
  if (dealerIds.length === 0) return out;

  const describe = (dealerId: number, lcd: string | null): DealerCapture => {
    const freshness = freshnessFor(lcd, todayPacific);
    return {
      dealerId,
      lcd,
      ageDays: lcdAgeDays(lcd, todayPacific),
      freshness,
      inScope: isInScope(freshness, scope),
    };
  };

  // Newest capture date anywhere. No dealer can hold a snapshot later than
  // this, so any dealer present on it has it as its own LCD.
  const { data: newest } = await supabase
    .from("inventory_snapshots")
    .select("snapshot_date")
    .order("snapshot_date", { ascending: false })
    .limit(1)
    .maybeSingle();

  const newestDate = (newest as { snapshot_date: string } | null)?.snapshot_date ?? null;
  if (!newestDate) {
    for (const id of dealerIds) out.set(id, describe(id, null));
    return out;
  }

  const onNewest = await fetchAllRows<{ dealer_id: number }>(
    "lcd: dealers on newest date",
    (from, to) =>
      supabase
        .from("inventory_snapshots")
        .select("dealer_id")
        .eq("snapshot_date", newestDate)
        .in("dealer_id", dealerIds)
        .range(from, to)
  );

  const resolved = new Set<number>();
  for (const r of onNewest) {
    if (!resolved.has(r.dealer_id)) {
      resolved.add(r.dealer_id);
      out.set(r.dealer_id, describe(r.dealer_id, newestDate));
    }
  }

  const remaining = dealerIds.filter((id) => !resolved.has(id));
  if (remaining.length === 0) return out;

  // For the rest, look back only as far as the oldest bucket we care about.
  // Anything with no row in this window is older than the window, which is
  // already enough to classify it as historic — we do not need its exact LCD.
  const windowStart = shiftDate(todayPacific, -STALE_MAX_DAYS);
  const recentDates = await fetchAllRows<{ dealer_id: number; snapshot_date: string }>(
    "lcd: recent dates for remaining dealers",
    (from, to) =>
      supabase
        .from("inventory_snapshots")
        .select("dealer_id, snapshot_date")
        .in("dealer_id", remaining)
        .gte("snapshot_date", windowStart)
        .lt("snapshot_date", newestDate)
        .order("snapshot_date", { ascending: false })
        .range(from, to)
  );

  const maxByDealer = new Map<number, string>();
  for (const r of recentDates) {
    const prev = maxByDealer.get(r.dealer_id);
    if (!prev || r.snapshot_date > prev) maxByDealer.set(r.dealer_id, r.snapshot_date);
  }

  for (const id of remaining) out.set(id, describe(id, maxByDealer.get(id) ?? null));
  return out;
}

/**
 * Snapshot rows for the in-scope cohort, each dealer read at its OWN LCD.
 *
 * Grouped by distinct LCD so the number of reads is bounded by how many
 * different capture dates the cohort spans (normally one), not by dealer
 * count. Returns rows only for dealers in scope, which is what keeps the
 * displayed cohort and the totals derived from it identical by construction.
 */
export async function loadCohortSnapshots(
  supabase: SupabaseLike,
  captures: Map<number, DealerCapture>
): Promise<SnapshotMetricRow[]> {
  const byDate = new Map<string, number[]>();
  for (const c of captures.values()) {
    if (!c.inScope || !c.lcd) continue;
    const list = byDate.get(c.lcd) ?? [];
    list.push(c.dealerId);
    byDate.set(c.lcd, list);
  }
  if (byDate.size === 0) return [];

  const perDate = await Promise.all(
    [...byDate.entries()].map(([date, ids]) =>
      fetchAllRows<SnapshotMetricRow>(`cohort snapshots ${date}`, (from, to) =>
        supabase
          .from("inventory_snapshots")
          .select("dealer_id, list_price")
          .eq("snapshot_date", date)
          .in("dealer_id", ids)
          .range(from, to)
      )
    )
  );

  return perDate.flat();
}

/** Inventory count per dealer, derived from the same rows that feed totals. */
export function inventoryByDealerFrom(rows: SnapshotMetricRow[]): Map<number, number> {
  const m = new Map<number, number>();
  for (const r of rows) m.set(r.dealer_id, (m.get(r.dealer_id) ?? 0) + 1);
  return m;
}

/** Re-export so callers need only one import for the common case. */
export { calendarDaysBetween };
