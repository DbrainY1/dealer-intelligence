// Server-side loader for Estimated Departures.
//
// One paged, narrow, set-based read over the window for the whole feed group.
// Nothing per-dealer, nothing truncated at the PostgREST 1,000-row cap.
//
// This is the "reusable daily process": the figures are recomputed from the
// validated daily feeds on every server render, so a newly captured day is
// reflected automatically with no job, no table and no write. Adding a future
// dealer-supplied feed means adding its dealer ids to a feed group — the
// arithmetic is unchanged.

import { fetchAllRowsCounted } from "./fetch-all.ts";
import { pacificDateStr } from "./dates.ts";
import type { SupabaseLike } from "./dealer-freshness.ts";
import {
  computeEstimatedDepartures,
  type DepartureReport,
  type FeedSnapshotRow,
} from "./estimated-departures.ts";

/**
 * A set of dealers whose inventory arrives as a supplied feed rather than a
 * scrape. Movement between dealers in the same group is a transfer.
 *
 * HomeNet (Baja Auto Group) is the only such feed today. Adding another feed
 * is a matter of adding an entry here.
 */
export interface FeedGroup {
  key: string;
  label: string;
  dealerIds: number[];
}

export const HOMENET_FEED: FeedGroup = {
  key: "homenet",
  label: "HomeNet feed",
  // Baja Auto Sales (1), Baja West (2), Newport Motors (3) — all source_type
  // 'homenet', all dealer_group_id 1.
  dealerIds: [1, 2, 3],
};

export const FEED_GROUPS: FeedGroup[] = [HOMENET_FEED];

/** First day of the Pacific month containing `today`. */
export function monthStartPacific(today: string): string {
  return `${today.slice(0, 7)}-01`;
}

/**
 * Load and compute the departure report for one feed group.
 *
 * Defaults to month-to-date in Pacific calendar terms, matching the capture
 * pipeline's own date boundaries.
 */
export async function loadEstimatedDepartures(
  supabase: SupabaseLike,
  group: FeedGroup = HOMENET_FEED,
  now: Date = new Date(),
  windowStartOverride?: string,
): Promise<DepartureReport> {
  const windowEnd = pacificDateStr(now);
  const windowStart = windowStartOverride ?? monthStartPacific(windowEnd);

  const base = () =>
    supabase
      .from("inventory_snapshots")
      .select("dealer_id, snapshot_date, vehicle_id")
      .in("dealer_id", group.dealerIds)
      .gte("snapshot_date", windowStart)
      .lte("snapshot_date", windowEnd);

  const rows = await fetchAllRowsCounted<FeedSnapshotRow>(
    `estimated departures ${group.key}`,
    () =>
      supabase
        .from("inventory_snapshots")
        .select("dealer_id", { count: "exact", head: true })
        .in("dealer_id", group.dealerIds)
        .gte("snapshot_date", windowStart)
        .lte("snapshot_date", windowEnd),
    (from, to) => base().range(from, to),
  );

  return computeEstimatedDepartures(rows, {
    feedDealerIds: group.dealerIds,
    windowStart,
    windowEnd,
  });
}
