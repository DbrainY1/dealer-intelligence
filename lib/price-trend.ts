// Seven-day price trend per dealer, computed server-side.
//
// Replaces /api/dealer/[id]/price-trend?days=7, which the Market Pulse page
// called once per dealer card from the browser. That fan-out cost one HTTP
// request, one serverless invocation and one database query per dealer, on
// every mount, with `cache: "no-store"`.
//
// The arithmetic below is a faithful port of that route: group the dealer's
// snapshot rows by snapshot_date, average the non-null list_price for each
// day, round, and derive avg/min/max across those daily means. The displayed
// numbers do not change.
//
// WHY NOT reuse the page's existing 90-day `allSnapshots` array:
// that read is issued per dealer and is NOT paged, so PostgREST caps it at
// 1,000 rows per dealer. It is therefore not a complete record and must not
// back a figure we present as a 7-day average. This module instead does one
// paged, narrow, set-based read over the window it actually needs.

import { fetchAllRowsCounted } from "./fetch-all.ts";
import { shiftDate, type SupabaseLike } from "./dealer-freshness.ts";

/** One dealer's rolled-up price window. */
export interface PriceTrend {
  /** Rounded daily mean list price, oldest first. */
  dailyAverages: number[];
  avg: number;
  min: number;
  max: number;
}

export interface PriceTrendRow {
  dealer_id: number;
  snapshot_date: string;
  list_price: number | null;
}

/** Window length, matching the `?days=7` the component used to request. */
export const TREND_DAYS = 7;

/**
 * Group rows into per-dealer daily means, then avg/min/max of those means.
 *
 * Pure — callers supply the rows. A dealer with no priced row in the window
 * is simply absent from the result, which the UI renders as "No data" exactly
 * as the empty API response did.
 */
export function buildPriceTrends(rows: PriceTrendRow[]): Map<number, PriceTrend> {
  // dealer -> date -> prices
  const byDealer = new Map<number, Map<string, number[]>>();
  for (const r of rows) {
    if (r.list_price == null) continue;
    let dates = byDealer.get(r.dealer_id);
    if (!dates) {
      dates = new Map<string, number[]>();
      byDealer.set(r.dealer_id, dates);
    }
    const list = dates.get(r.snapshot_date);
    if (list) list.push(r.list_price);
    else dates.set(r.snapshot_date, [r.list_price]);
  }

  const out = new Map<number, PriceTrend>();
  for (const [dealerId, dates] of byDealer) {
    const dailyAverages = [...dates.entries()]
      .sort((a, b) => a[0].localeCompare(b[0]))
      .map(([, prices]) => Math.round(prices.reduce((a, b) => a + b, 0) / prices.length));

    if (dailyAverages.length === 0) continue;

    out.set(dealerId, {
      dailyAverages,
      avg: Math.round(dailyAverages.reduce((a, b) => a + b, 0) / dailyAverages.length),
      min: Math.min(...dailyAverages),
      max: Math.max(...dailyAverages),
    });
  }
  return out;
}

/**
 * Load the trend window for `dealerIds` in one paged, set-based read.
 *
 * One logical query for the whole roster, paged so nothing truncates —
 * replacing N browser round trips.
 */
export async function loadPriceTrends(
  supabase: SupabaseLike,
  dealerIds: number[],
  todayPacific: string,
  days: number = TREND_DAYS
): Promise<Map<number, PriceTrend>> {
  if (dealerIds.length === 0) return new Map();

  // The old route used `new Date()` minus N days in UTC. Anchoring on the
  // Pacific calendar date instead keeps the window aligned with the capture
  // pipeline's own date boundaries.
  const windowStart = shiftDate(todayPacific, -days);

  // The window spans several thousand rows, so page it concurrently: one
  // cheap head-count, then every page at once. Walking pages sequentially
  // here cost roughly a second per page.
  const base = () =>
    supabase
      .from("inventory_snapshots")
      .select("dealer_id, snapshot_date, list_price")
      .in("dealer_id", dealerIds)
      .gte("snapshot_date", windowStart)
      .not("list_price", "is", null);

  const rows = await fetchAllRowsCounted<PriceTrendRow>(
    "price trend window",
    () =>
      supabase
        .from("inventory_snapshots")
        .select("dealer_id", { count: "exact", head: true })
        .in("dealer_id", dealerIds)
        .gte("snapshot_date", windowStart)
        .not("list_price", "is", null),
    (from, to) => base().range(from, to)
  );

  return buildPriceTrends(rows);
}
