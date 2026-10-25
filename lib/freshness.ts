// Dealer capture freshness.
//
// A dealer's Last Captured Date (LCD) is the most recent snapshot_date for
// which that dealer actually has rows in inventory_snapshots.
//
// WHY inventory_snapshots AND NOT the alternatives:
//   - dealers.last_success is stale in production (frozen months behind while
//     captures were still running), so it cannot be used.
//   - scrape_log.status = 'success' is not proof that inventory landed; a run
//     can report success and write no rows.
//   - coverage_report records a CHECK, not a capture. It can carry a
//     checked_date one day later than the newest snapshot for the same dealer,
//     so using it would overstate freshness.
//
// Counting inventory from inventory_snapshots and deriving LCD from the same
// table is what guarantees the invariant the product requires: the dealers
// shown and the dealers summed into the totals are always the same set.
//
// A dealer with no capture in range is simply out of scope. It is never
// treated as zero inventory, never counted as a sale or a disappearance, and
// its history is never modified.

/** Freshness buckets, defined on Pacific calendar days. */
export type Freshness = "current" | "recent" | "stale" | "historic";

/** Which freshness buckets feed the current-market view and its totals. */
export type MarketScope = "current" | "current_recent";

export const DEFAULT_SCOPE: MarketScope = "current_recent";

/** Inclusive upper bound, in days, for each bucket. */
export const CURRENT_MAX_DAYS = 1;
export const RECENT_MAX_DAYS = 7;
export const STALE_MAX_DAYS = 14;

export const FRESHNESS_LABEL: Record<Freshness, string> = {
  current: "Current",
  recent: "Recent",
  stale: "Stale",
  historic: "Historic",
};

/**
 * Whole calendar days from `fromDate` to `toDate`, both `YYYY-MM-DD`.
 *
 * Anchored at UTC noon so a DST transition can never shift the result by a
 * day. These are calendar dates, not instants: snapshot_date is written by the
 * Pacific-scheduled DBRAIN pipeline as a Pacific calendar date, so comparing
 * it against the Pacific calendar date of "now" is the correct arithmetic.
 */
export function calendarDaysBetween(fromDate: string, toDate: string): number {
  const a = Date.UTC(
    Number(fromDate.slice(0, 4)),
    Number(fromDate.slice(5, 7)) - 1,
    Number(fromDate.slice(8, 10)),
    12
  );
  const b = Date.UTC(
    Number(toDate.slice(0, 4)),
    Number(toDate.slice(5, 7)) - 1,
    Number(toDate.slice(8, 10)),
    12
  );
  return Math.round((b - a) / 86_400_000);
}

/**
 * Bucket for a dealer whose LCD is `lcd`, relative to the Pacific date `today`.
 *
 * A null/absent LCD means the dealer has never produced a validated capture
 * and is treated as `historic` — out of the current market, history intact.
 * A future-dated LCD (clock skew) is clamped to `current` rather than
 * producing a negative age.
 */
export function freshnessFor(lcd: string | null | undefined, today: string): Freshness {
  if (!lcd) return "historic";
  const age = calendarDaysBetween(lcd, today);
  if (age <= CURRENT_MAX_DAYS) return "current";
  if (age <= RECENT_MAX_DAYS) return "recent";
  if (age <= STALE_MAX_DAYS) return "stale";
  return "historic";
}

/** Age in days, or null when the dealer has never captured. */
export function lcdAgeDays(lcd: string | null | undefined, today: string): number | null {
  if (!lcd) return null;
  return Math.max(0, calendarDaysBetween(lcd, today));
}

/** Whether a bucket belongs to the selected market scope. */
export function isInScope(freshness: Freshness, scope: MarketScope): boolean {
  if (scope === "current") return freshness === "current";
  return freshness === "current" || freshness === "recent";
}

/** Buckets included by a scope, for labelling. */
export function scopeBuckets(scope: MarketScope): Freshness[] {
  return scope === "current" ? ["current"] : ["current", "recent"];
}

/** Narrow an untrusted value (e.g. a search param) to a MarketScope. */
export function parseScope(value: string | string[] | undefined): MarketScope {
  const v = Array.isArray(value) ? value[0] : value;
  return v === "current" ? "current" : DEFAULT_SCOPE;
}

export const SCOPE_LABEL: Record<MarketScope, string> = {
  current: "Current only",
  current_recent: "Current + Recent",
};

export const SCOPE_DESCRIPTION: Record<MarketScope, string> = {
  current: "Captured in the last 0–1 days",
  current_recent: "Captured in the last 0–7 days",
};
