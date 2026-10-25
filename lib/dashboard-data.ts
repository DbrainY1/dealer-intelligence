// Data loading for the Market Overview dashboard (app/dashboard/page.tsx).
//
// Split out of the page component so the query strategy can be exercised
// directly against fixtures — see dashboard-data.test.ts, which runs this
// loader and the previous per-dealer loader over the same fake PostgREST and
// asserts the rendered figures match.
//
// Query shape: three dependency waves, all set-based. The previous
// implementation issued roughly `6N + 18` requests for N dealers across six
// sequential waves; this issues a small fixed set plus one extra page per
// 1,000 rows on the large reads, and no longer scales with the dealer roster.
//
// Figures describe the freshness cohort selected by `scope`, never the whole
// roster. Dealers outside the cohort are reported separately in
// `excludedDealers` — they are withheld, not zeroed.

import { dedupeProjectedSold } from "./projected-sold.ts";
import { pacificDateStr } from "./dates.ts";
import { fetchAllRows, chunk } from "./fetch-all.ts";
import {
  deriveCanonicalCutoff,
  sumSoldForMonth,
  groupDailySoldByDealer,
  buildDealerRows,
  averageListPrice,
  aggregateSnapshotStats,
  sellThroughToday as computeSellThroughToday,
  sellThroughComparison,
  countActiveDealers,
  sumInventory,
  type MonthlySalesRow,
  type SnapshotMetricRow,
  type VehicleDetail,
  type DealerRow,
  type SnapshotStats,
} from "./dashboard-metrics.ts";
import {
  resolveDealerCaptures,
  loadCohortSnapshots,
  inventoryByDealerFrom,
  type DealerCapture,
} from "./dealer-freshness.ts";
import {
  DEFAULT_SCOPE,
  type Freshness,
  type MarketScope,
} from "./freshness.ts";
import type { Dealer, InventoryEvent } from "../types/index.ts";

/** Minimal shape of the PostgREST client this loader needs. */
export interface SupabaseLike {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  from(table: string): any;
}

/** A dealer held out of the current market, with the reason it was held out. */
export interface ExcludedDealer {
  id: number;
  name: string;
  lcd: string | null;
  ageDays: number | null;
  freshness: Freshness;
}

export interface MarketOverview {
  /** The in-scope cohort. Every headline figure below derives from exactly this set. */
  dealerList: Dealer[];
  byDealer: DealerRow[];
  canonicalCutoff: string | null;
  activeDealersToday: number;
  totalInventory: number;
  avgPrice: number;
  sellThroughToday: number | null;
  sellThroughLastMo: number | null;
  sellThroughLastYr: number | null;
  lastMoStats: SnapshotStats | null;
  lastYrStats: SnapshotStats | null;
  /** Freshness context for the UI. */
  scope: MarketScope;
  todayPacific: string;
  captures: Map<number, DealerCapture>;
  excludedDealers: ExcludedDealer[];
  /** Full monitored roster size, before the freshness filter. */
  monitoredDealerCount: number;
}

type Supa = SupabaseLike;


/** Latest snapshot date at or before `cutoffStr`, or null when none exists. */
async function latestSnapshotDateOnOrBefore(
  supabase: Supa,
  cutoffStr: string
): Promise<string | null> {
  const { data } = await supabase
    .from("inventory_snapshots")
    .select("snapshot_date")
    .lte("snapshot_date", cutoffStr)
    .order("snapshot_date", { ascending: false })
    .limit(1)
    .maybeSingle();
  return (data as { snapshot_date: string } | null)?.snapshot_date ?? null;
}

/** Every (dealer_id, list_price) row on one snapshot date, fully paged. */
async function snapshotRowsOnDate(
  supabase: Supa,
  snapDate: string,
  label: string
): Promise<SnapshotMetricRow[]> {
  return fetchAllRows<SnapshotMetricRow>(label, (from, to) =>
    supabase
      .from("inventory_snapshots")
      .select("dealer_id, list_price")
      .eq("snapshot_date", snapDate)
      .range(from, to)
  );
}

/**
 * Comparison-period stats.
 *
 * Previously this issued three unpaged queries and derived `activeDealers` and
 * `avgPrice` from at most 1,000 rows, so both were wrong whenever the market
 * held more than 1,000 units on the comparison date. One paged read now backs
 * all three figures.
 */
async function getSnapshotStats(
  supabase: Supa,
  snapDate: string | null,
  label: string
): Promise<{ activeDealers: number; inventory: number; avgPrice: number | null } | null> {
  if (!snapDate) return null;
  return aggregateSnapshotStats(await snapshotRowsOnDate(supabase, snapDate, label));
}

/**
 * Load every figure the Market Overview renders.
 *
 * @param now Injected clock so tests are deterministic.
 */
export async function loadMarketOverview(
  supabase: Supa,
  now: Date = new Date(),
  scope: MarketScope = DEFAULT_SCOPE
): Promise<MarketOverview> {
  const today = now;
  // Freshness is measured on Pacific calendar days, matching the timezone the
  // DBRAIN capture pipeline is scheduled in.
  const todayPacific = pacificDateStr(now);
  // ── Dynamic date anchors ────────────────────────────────────────────────────
  const monthStart = new Date(today.getFullYear(), today.getMonth(), 1);
  const monthStartStr = monthStart.toISOString().split("T")[0];

  const lastMoCutoff = new Date(today);
  lastMoCutoff.setMonth(lastMoCutoff.getMonth() - 1);
  const lastMoCutoffStr = lastMoCutoff.toISOString().split("T")[0];

  const lastMoMonthStart = new Date(lastMoCutoff.getFullYear(), lastMoCutoff.getMonth(), 1);
  const lastMoMonthStartStr = lastMoMonthStart.toISOString().split("T")[0];

  const lastYrCutoff = new Date(today);
  lastYrCutoff.setFullYear(lastYrCutoff.getFullYear() - 1);
  const lastYrCutoffStr = lastYrCutoff.toISOString().split("T")[0];

  const lastYrMonthStart = new Date(lastYrCutoff.getFullYear(), lastYrCutoff.getMonth(), 1);
  const lastYrMonthStartStr = lastYrMonthStart.toISOString().split("T")[0];

  // Daily Sold is anchored to the current Pacific calendar date to match the
  // DBRAIN Daily Market Movement email's date axis.
  const dailyDateStr = pacificDateStr(now);
  const DAILY_COLS =
    "id, vehicle_id, event_type, event_date, from_dealer_id, price_at_listing, last_seen_price";
  // Shape of the DAILY_COLS projection; widened to InventoryEvent at the point
  // of use, exactly as the original code did.
  type DailyEventRow = Pick<
    InventoryEvent,
    "id" | "vehicle_id" | "event_type" | "event_date" | "from_dealer_id" | "price_at_listing" | "last_seen_price"
  >;

  // ── Wave 1 — every read with no dependency on another read ──────────────────
  //
  // Previously these ran as several sequential waves, with two of them looping
  // once per dealer (6 queries each). They are now set-based and issued
  // together, so the request count no longer scales with the dealer roster.
  const [
    dealersRes,
    monthlySalesRes,
    lastMoDate,
    lastYrDate,
    dailySoldRaw,
    dailyPendingRaw,
    dailyTransferredRaw,
    addedEventRows,
    transferredEventRows,
  ] = await Promise.all([
    // Only id/name/dealer_group_id are consumed downstream (MarketCharts reads
    // name + id); the previous select("*") pulled every column unused.
    supabase.from("dealers").select("id, name, dealer_group_id"),

    supabase
      .from("monthly_sales")
      .select("dealer_id, units_sold, month_start, computed_by, projection_cutoff")
      .in("month_start", [monthStartStr, lastMoMonthStartStr, lastYrMonthStartStr]),

    latestSnapshotDateOnOrBefore(supabase, lastMoCutoffStr),
    latestSnapshotDateOnOrBefore(supabase, lastYrCutoffStr),

    fetchAllRows<DailyEventRow>("daily sold", (from, to) =>
      supabase
        .from("inventory_events")
        .select(DAILY_COLS)
        .eq("event_type", "sold")
        .eq("event_date", dailyDateStr)
        .not("from_dealer_id", "is", null)
        .range(from, to)
    ),
    fetchAllRows<DailyEventRow>("daily pending_removal", (from, to) =>
      supabase
        .from("inventory_events")
        .select(DAILY_COLS)
        .eq("event_type", "pending_removal")
        .is("resolved_at", null)
        .eq("event_date", dailyDateStr)
        .not("from_dealer_id", "is", null)
        .range(from, to)
    ),
    fetchAllRows<{ vehicle_id: number }>("daily transferred", (from, to) =>
      supabase
        .from("inventory_events")
        .select("vehicle_id")
        .eq("event_type", "transferred")
        .eq("event_date", dailyDateStr)
        .range(from, to)
    ),

    // MTD added / transferred, once for the whole market instead of twice per
    // dealer. The old per-dealer queries read `.length` off an unpaged result,
    // so any dealer above 1,000 events reported a truncated number.
    fetchAllRows<{ to_dealer_id: number | null }>("mtd added", (from, to) =>
      supabase
        .from("inventory_events")
        .select("to_dealer_id")
        .eq("event_type", "added")
        .eq("excluded_from_metrics", false)
        .gte("event_date", monthStartStr)
        .range(from, to)
    ),
    fetchAllRows<{ to_dealer_id: number | null }>("mtd transferred", (from, to) =>
      supabase
        .from("inventory_events")
        .select("to_dealer_id")
        .eq("event_type", "transferred")
        .eq("excluded_from_metrics", false)
        .gte("event_date", monthStartStr)
        .range(from, to)
    ),
  ]);

  const dealerList: Dealer[] = (dealersRes.data as Dealer[] | null) ?? [];
  const allMonthlySales: MonthlySalesRow[] =
    (monthlySalesRes.data as MonthlySalesRow[] | null) ?? [];

  // Canonical partial-month cutoff for the CURRENT month (NULL for legacy).
  // Derived from projection_cutoff — never hardcoded.
  const canonicalCutoff = deriveCanonicalCutoff(allMonthlySales, monthStartStr);

  // Comparison-period sums stay whole-market: their denominators
  // (lastMoStats / lastYrStats) are whole-market counts on those historical
  // dates, so both sides of those ratios already describe the same population.
  const soldLastMo = sumSoldForMonth(allMonthlySales, lastMoMonthStartStr);
  const soldLastYr = sumSoldForMonth(allMonthlySales, lastYrMonthStartStr);

  const tally = (rows: { to_dealer_id: number | null }[]) => {
    const m = new Map<number, number>();
    for (const r of rows) {
      if (r.to_dealer_id != null) m.set(r.to_dealer_id, (m.get(r.to_dealer_id) ?? 0) + 1);
    }
    return m;
  };
  const addedByDealer = tally(addedEventRows);
  const transferredByDealer = tally(transferredEventRows);

  // Estimated Sales / Daily Sold implements the V2 read-layer projected-sold
  // rule from DBRAIN_V2_CUTOVER_NOTES.md and matches the DBRAIN Daily Market
  // Movement email logic. Confirmed Sold + Pending Sale, deduplicated by
  // vehicle, sold preferred, transfers excluded, from_dealer_id attribution.
  // MTD Sold continues to use monthly_sales / resolved_at and is unchanged.
  const dailyTransferIds = new Set<number>(
    dailyTransferredRaw.map((r) => r.vehicle_id).filter((v) => v != null)
  );
  const dailyProjected = dedupeProjectedSold(
    dailySoldRaw as InventoryEvent[],
    dailyPendingRaw as InventoryEvent[],
    dailyTransferIds
  );
  const dailyVehicleIds = [...new Set(dailyProjected.map((e) => e.vehicle_id))];

  // ── Wave 2 — reads that needed Wave 1's results ─────────────────────────────
  //
  // The cohort is resolved from each dealer's own LCD and filtered to the
  // selected freshness scope BEFORE any total is computed, so the dealers
  // listed and the dealers summed are the same set by construction.
  const [captures, lastMoStats, lastYrStats, dailyVehicleRows] = await Promise.all([
    resolveDealerCaptures(
      supabase,
      dealerList.map((d) => d.id),
      todayPacific,
      scope
    ),

    getSnapshotStats(supabase, lastMoDate, "last-month snapshots"),
    getSnapshotStats(supabase, lastYrDate, "last-year snapshots"),

    // Vehicle detail for the Daily Sold expansion rows. Chunked only to keep
    // the `in.(…)` filter inside URL limits, and now issued in parallel rather
    // than one chunk at a time.
    Promise.all(
      chunk(dailyVehicleIds, 200).map((ids) =>
        supabase.from("vehicles").select("id, year, make, model, vin").in("id", ids)
      )
    ),
  ]);

  // Snapshot rows for the in-scope cohort only, each dealer read at its own
  // LCD. Out-of-scope dealers contribute no rows — they are absent from the
  // market view, NOT recorded as zero inventory.
  const cohortRows = await loadCohortSnapshots(supabase, captures);
  const inventoryByDealer = inventoryByDealerFrom(cohortRows);
  const pricedRows: SnapshotMetricRow[] = cohortRows;

  // The dealers the page lists. Identical to the set the totals come from.
  const cohortDealers = dealerList.filter((d) => captures.get(d.id)?.inScope === true);

  // Current-period sell-through must divide the cohort's sales by the cohort's
  // inventory. Summing sales across the whole roster while the denominator
  // covers only in-scope dealers would inflate the rate.
  const cohortIds = new Set(cohortDealers.map((d) => d.id));
  const soldThisMonth = sumSoldForMonth(
    allMonthlySales.filter((r) => cohortIds.has(r.dealer_id)),
    monthStartStr
  );

  const excludedDealers: ExcludedDealer[] = dealerList
    .filter((d) => captures.get(d.id)?.inScope !== true)
    .map((d) => {
      const c = captures.get(d.id);
      return {
        id: d.id,
        name: d.name,
        lcd: c?.lcd ?? null,
        ageDays: c?.ageDays ?? null,
        freshness: c?.freshness ?? "historic",
      };
    });

  // ── Wave 3 — latest mileage for the Daily Sold vehicles ─────────────────────
  const dailyVehicleMap = new Map<number, VehicleDetail>();
  for (const res of dailyVehicleRows) {
    for (const v of (res.data ?? []) as {
      id: number;
      year: number | null;
      make: string | null;
      model: string | null;
      vin: string | null;
    }[]) {
      dailyVehicleMap.set(v.id, {
        year: v.year,
        make: v.make,
        model: v.model,
        vin: v.vin,
        mileage: null,
      });
    }
  }

  if (dailyVehicleIds.length > 0) {
    // Ordered newest-first, so the first row seen per vehicle is its latest
    // mileage — the same rule the chunked version applied. Paging stops as soon
    // as every vehicle has been seen, which is usually the first page.
    const seen = new Set<number>();
    const mileageRows = await fetchAllRows<{ vehicle_id: number; mileage: number | null }>(
      "daily sold mileage",
      (from, to) =>
        supabase
          .from("inventory_snapshots")
          .select("vehicle_id, mileage")
          .in("vehicle_id", dailyVehicleIds)
          .order("snapshot_date", { ascending: false })
          .range(from, to),
      (rows) => {
        for (const r of rows) seen.add(r.vehicle_id);
        return seen.size >= dailyVehicleIds.length;
      }
    );
    const applied = new Set<number>();
    for (const s of mileageRows) {
      if (applied.has(s.vehicle_id)) continue;
      const existing = dailyVehicleMap.get(s.vehicle_id);
      if (existing) existing.mileage = s.mileage ?? null;
      applied.add(s.vehicle_id);
    }
  }

  // ── Derived values ──────────────────────────────────────────────────────────
  const dailyByDealer = groupDailySoldByDealer(dailyProjected, dailyVehicleMap);

  // Built from the cohort, not the full roster: an out-of-scope dealer must
  // not appear as a row of zeros, which would read as an empty lot.
  const byDealer = buildDealerRows(
    cohortDealers,
    inventoryByDealer,
    allMonthlySales,
    monthStartStr,
    addedByDealer,
    transferredByDealer,
    dailyByDealer
  );

  const activeDealersToday = countActiveDealers(byDealer);
  const totalInventory = sumInventory(byDealer);
  const avgPrice = averageListPrice(pricedRows);

  const sellThroughToday = computeSellThroughToday(soldThisMonth, totalInventory);
  const sellThroughLastMo = sellThroughComparison(lastMoStats, soldLastMo);
  const sellThroughLastYr = sellThroughComparison(lastYrStats, soldLastYr);

  return {
    dealerList: cohortDealers,
    byDealer,
    scope,
    todayPacific,
    captures,
    excludedDealers,
    monitoredDealerCount: dealerList.length,
    canonicalCutoff,
    activeDealersToday,
    totalInventory,
    avgPrice,
    sellThroughToday,
    sellThroughLastMo,
    sellThroughLastYr,
    lastMoStats,
    lastYrStats,
  };
}
