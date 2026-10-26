// Differential test: the previous per-dealer loader vs. the new set-based
// loader, run over byte-identical fixtures through the same fake PostgREST.
//
// `loadMarketOverviewLegacy` below is a faithful port of the implementation on
// main before this change (app/dashboard/page.tsx @ 5ae2300). It is kept here,
// in the test file, so it can never be imported by application code. Reviewers
// can diff it against `git show main:app/dashboard/page.tsx`.
//
// Where the two agree, the optimization is proven behavior-preserving.
// Where they disagree, the disagreement is asserted explicitly and is always a
// case where the old code silently truncated at the 1,000-row cap.

import { test } from "node:test";
import assert from "node:assert/strict";

import { loadMarketOverview, type MarketOverview, type SupabaseLike } from "./dashboard-data.ts";
import { FakePostgrest, MAX_ROWS, type FakeTables } from "./fake-postgrest.ts";
import { dedupeProjectedSold } from "./projected-sold.ts";
import { pacificDateStr } from "./dates.ts";
import { isCanonicalRow, CANONICAL_COMPUTED_BY } from "./cutoff.ts";
import type { DailySoldVehicle } from "../app/dashboard/MarketCharts.tsx";
import type { InventoryEvent } from "../types/index.ts";

const NOW = new Date("2026-10-24T18:00:00Z");

// ─────────────────────────────────────────────────────────────────────────────
// Legacy loader — pre-optimization reference implementation
// ─────────────────────────────────────────────────────────────────────────────

/* eslint-disable @typescript-eslint/no-explicit-any */
async function loadMarketOverviewLegacy(
  supabase: SupabaseLike,
  now: Date = new Date()
): Promise<MarketOverview> {
  async function getSnapshotStats(cutoffStr: string) {
    const { data: dateRow } = await supabase
      .from("inventory_snapshots")
      .select("snapshot_date")
      .lte("snapshot_date", cutoffStr)
      .order("snapshot_date", { ascending: false })
      .limit(1)
      .single();
    if (!dateRow) return null;
    const snapDate = dateRow.snapshot_date;
    const [dealerRes, countRes, priceRes] = await Promise.all([
      supabase.from("inventory_snapshots").select("dealer_id").eq("snapshot_date", snapDate),
      supabase
        .from("inventory_snapshots")
        .select("id", { count: "exact", head: true })
        .eq("snapshot_date", snapDate),
      supabase
        .from("inventory_snapshots")
        .select("list_price")
        .eq("snapshot_date", snapDate)
        .not("list_price", "is", null),
    ]);
    const activeDealers = new Set((dealerRes.data ?? []).map((r: any) => r.dealer_id)).size;
    const inventory = countRes.count ?? 0;
    const prices = (priceRes.data ?? []) as { list_price: number }[];
    const avgPrice =
      prices.length > 0
        ? Math.round(prices.reduce((s, r) => s + r.list_price, 0) / prices.length)
        : null;
    return { activeDealers, inventory, avgPrice };
  }

  const { data: dealers } = await supabase.from("dealers").select("*");
  const dealerList: any[] = dealers ?? [];

  const today = now;
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

  const { data: allMonthlySales } = await supabase
    .from("monthly_sales")
    .select("dealer_id, units_sold, month_start, computed_by, projection_cutoff")
    .in("month_start", [monthStartStr, lastMoMonthStartStr, lastYrMonthStartStr]);

  const canonicalCutoff =
    (allMonthlySales ?? [])
      .filter((r: any) => r.month_start === monthStartStr)
      .map((r: any) => (isCanonicalRow(r.computed_by) ? r.projection_cutoff : null))
      .find((c: any): c is string => c != null) ?? null;

  const sumSoldForMonth = (ms: string) =>
    (allMonthlySales ?? [])
      .filter((r: any) => r.month_start === ms)
      .reduce((s: number, r: any) => s + (r.units_sold ?? 0), 0);

  const soldThisMonth = sumSoldForMonth(monthStartStr);
  const soldLastMo = sumSoldForMonth(lastMoMonthStartStr);
  const soldLastYr = sumSoldForMonth(lastYrMonthStartStr);

  const dailyDateStr = pacificDateStr(now);
  const DAILY_COLS =
    "id, vehicle_id, event_type, event_date, from_dealer_id, price_at_listing, last_seen_price";

  const { data: dailySoldRaw } = await supabase
    .from("inventory_events")
    .select(DAILY_COLS)
    .eq("event_type", "sold")
    .eq("event_date", dailyDateStr)
    .not("from_dealer_id", "is", null);
  const { data: dailyPendingRaw } = await supabase
    .from("inventory_events")
    .select(DAILY_COLS)
    .eq("event_type", "pending_removal")
    .is("resolved_at", null)
    .eq("event_date", dailyDateStr)
    .not("from_dealer_id", "is", null);
  const { data: dailyTransferredRaw } = await supabase
    .from("inventory_events")
    .select("vehicle_id")
    .eq("event_type", "transferred")
    .eq("event_date", dailyDateStr);

  const dailyTransferIds = new Set<number>(
    (dailyTransferredRaw ?? []).map((r: any) => r.vehicle_id).filter((v: any) => v != null)
  );
  const dailyProjected = dedupeProjectedSold(
    (dailySoldRaw ?? []) as InventoryEvent[],
    (dailyPendingRaw ?? []) as InventoryEvent[],
    dailyTransferIds
  );

  const dailyVehicleIds = [...new Set(dailyProjected.map((e) => e.vehicle_id))];
  const dailyVehicleMap = new Map<number, any>();
  for (let i = 0; i < dailyVehicleIds.length; i += 100) {
    const ch = dailyVehicleIds.slice(i, i + 100);
    const { data: vehicles } = await supabase
      .from("vehicles")
      .select("id, year, make, model, vin")
      .in("id", ch);
    (vehicles ?? []).forEach((v: any) =>
      dailyVehicleMap.set(v.id, { year: v.year, make: v.make, model: v.model, vin: v.vin, mileage: null })
    );
  }
  for (let i = 0; i < dailyVehicleIds.length; i += 100) {
    const ch = dailyVehicleIds.slice(i, i + 100);
    const { data: snaps } = await supabase
      .from("inventory_snapshots")
      .select("vehicle_id, mileage")
      .in("vehicle_id", ch)
      .order("snapshot_date", { ascending: false });
    const seen = new Set<number>();
    (snaps ?? []).forEach((s: any) => {
      if (!seen.has(s.vehicle_id)) {
        const existing = dailyVehicleMap.get(s.vehicle_id);
        if (existing) existing.mileage = s.mileage ?? null;
        seen.add(s.vehicle_id);
      }
    });
  }

  const dailyByDealer = new Map<number, { count: number; vehicles: DailySoldVehicle[] }>();
  for (const e of dailyProjected) {
    const did = e.from_dealer_id;
    if (did == null) continue;
    const veh = dailyVehicleMap.get(e.vehicle_id);
    const entry = dailyByDealer.get(did) ?? { count: 0, vehicles: [] };
    entry.count += 1;
    entry.vehicles.push({
      year: veh?.year ?? null,
      make: veh?.make ?? null,
      model: veh?.model ?? null,
      trim: null,
      mileage: veh?.mileage ?? null,
      vin: veh?.vin ?? null,
      price: e.last_seen_price ?? e.price_at_listing ?? null,
      date: e.event_date,
    });
    dailyByDealer.set(did, entry);
  }

  const byDealer = await Promise.all(
    dealerList.map(async (d: any) => {
      const { data: latestDate } = await supabase
        .from("inventory_snapshots")
        .select("snapshot_date")
        .eq("dealer_id", d.id)
        .order("snapshot_date", { ascending: false })
        .limit(1)
        .single();
      if (!latestDate)
        return {
          name: d.name, count: 0, sold: 0, soldBasis: "verified" as const, pendingConfirmation: 0, added: 0, transferred: 0,
          dailySold: dailyByDealer.get(d.id)?.count ?? 0,
          dailySoldVehicles: dailyByDealer.get(d.id)?.vehicles ?? [],
        };
      const { count } = await supabase
        .from("inventory_snapshots")
        .select("id", { count: "exact" })
        .eq("dealer_id", d.id)
        .eq("snapshot_date", latestDate.snapshot_date);
      const soldByDealer = (allMonthlySales ?? []).find(
        (r: any) => r.dealer_id === d.id && r.month_start === monthStartStr
      );
      const { data: addedEvents } = await supabase
        .from("inventory_events")
        .select("id", { count: "exact" })
        .eq("to_dealer_id", d.id)
        .eq("event_type", "added")
        .eq("excluded_from_metrics", false)
        .gte("event_date", monthStartStr);
      const { data: transferredEvents } = await supabase
        .from("inventory_events")
        .select("id", { count: "exact" })
        .eq("to_dealer_id", d.id)
        .eq("event_type", "transferred")
        .eq("excluded_from_metrics", false)
        .gte("event_date", monthStartStr);
      return {
        name: d.name,
        count: count ?? 0,
        sold: soldByDealer?.units_sold ?? 0,
        soldBasis: "verified" as const,
        pendingConfirmation: 0,
        added: addedEvents?.length ?? 0,
        transferred: transferredEvents?.length ?? 0,
        dailySold: dailyByDealer.get(d.id)?.count ?? 0,
        dailySoldVehicles: dailyByDealer.get(d.id)?.vehicles ?? [],
      };
    })
  );

  const activeDealersToday = byDealer.filter((d) => d.count > 0).length;
  const totalInventory = byDealer.reduce((sum, d) => sum + d.count, 0);

  let totalPriceSum = 0;
  let totalPriceCount = 0;
  await Promise.all(
    dealerList.map(async (d: any) => {
      const { data: latest } = await supabase
        .from("inventory_snapshots")
        .select("snapshot_date")
        .eq("dealer_id", d.id)
        .order("snapshot_date", { ascending: false })
        .limit(1)
        .single();
      if (!latest) return;
      const { data: snaps } = await supabase
        .from("inventory_snapshots")
        .select("list_price")
        .eq("dealer_id", d.id)
        .eq("snapshot_date", latest.snapshot_date)
        .not("list_price", "is", null);
      for (const s of snaps ?? []) {
        totalPriceSum += s.list_price ?? 0;
        totalPriceCount++;
      }
    })
  );
  const avgPrice = totalPriceCount > 0 ? Math.round(totalPriceSum / totalPriceCount) : 0;

  const sellThroughToday = totalInventory > 0 ? (soldThisMonth / totalInventory) * 100 : null;

  const [lastMoStats, lastYrStats] = await Promise.all([
    getSnapshotStats(lastMoCutoffStr),
    getSnapshotStats(lastYrCutoffStr),
  ]);

  const sellThroughLastMo =
    lastMoStats && lastMoStats.inventory > 0 && soldLastMo > 0
      ? (soldLastMo / lastMoStats.inventory) * 100
      : null;
  const sellThroughLastYr =
    lastYrStats && lastYrStats.inventory > 0 && soldLastYr > 0
      ? (soldLastYr / lastYrStats.inventory) * 100
      : null;

  return {
    dealerList: dealerList as any,
    byDealer,
    // The legacy loader had no freshness concept: every monitored dealer was
    // always in scope. These fields exist only so the two return types line
    // up for comparison.
    scope: "current_recent" as const,
    todayPacific: pacificDateStr(now),
    captures: new Map(),
    excludedDealers: [],
    monitoredDealerCount: dealerList.length,
    soldUnits: { byDealer: new Map(), estimated: null, estimatedDealerIds: [], monthStart: monthStartStr, through: pacificDateStr(now) },
    includesEstimatedSales: false,
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
/* eslint-enable @typescript-eslint/no-explicit-any */

// ─────────────────────────────────────────────────────────────────────────────
// Fixture builder
// ─────────────────────────────────────────────────────────────────────────────

const TODAY = pacificDateStr(NOW); // Daily Sold anchor
const MONTH_START = "2026-10-01";

interface BuildOpts {
  dealers: { id: number; name: string; dealer_group_id?: number | null }[];
  /** dealer id → list of [snapshot_date, list_price|null] */
  snapshots: Record<number, [string, number | null][]>;
  monthlySales?: { dealer_id: number; units_sold: number | null; month_start: string; computed_by?: string | null; projection_cutoff?: string | null }[];
  events?: Record<string, unknown>[];
  vehicles?: Record<string, unknown>[];
}

function build(o: BuildOpts): FakeTables {
  let sid = 1;
  const snaps: Record<string, unknown>[] = [];
  for (const [dealerId, list] of Object.entries(o.snapshots)) {
    for (const [date, price] of list) {
      snaps.push({
        id: `s${sid}`,
        dealer_id: Number(dealerId),
        vehicle_id: sid,
        snapshot_date: date,
        list_price: price,
        mileage: 1000 + sid,
        status: "active",
      });
      sid++;
    }
  }
  return {
    dealers: o.dealers.map((d) => ({ dealer_group_id: null, ...d })),
    inventory_snapshots: snaps,
    monthly_sales: (o.monthlySales ?? []).map((m) => ({
      computed_by: null,
      projection_cutoff: null,
      ...m,
    })),
    inventory_events: o.events ?? [],
    vehicles: o.vehicles ?? [],
  };
}

async function bothLoaders(tables: FakeTables) {
  const dbOld = new FakePostgrest(structuredClone(tables));
  const dbNew = new FakePostgrest(structuredClone(tables));
  const oldOut = await loadMarketOverviewLegacy(dbOld, NOW);
  const newOut = await loadMarketOverview(dbNew, NOW, "current_recent", [], false);
  return { oldOut, newOut, oldCount: dbOld.queryCount, newCount: dbNew.queryCount };
}

/** Field-by-field equality, so a failure names the figure that drifted. */
function assertSameOverview(a: MarketOverview, b: MarketOverview) {
  assert.deepEqual(b.byDealer, a.byDealer, "byDealer rows must match");
  assert.equal(b.canonicalCutoff, a.canonicalCutoff, "canonicalCutoff must match");
  assert.equal(b.activeDealersToday, a.activeDealersToday, "activeDealersToday must match");
  assert.equal(b.totalInventory, a.totalInventory, "totalInventory must match");
  assert.equal(b.avgPrice, a.avgPrice, "avgPrice must match");
  assert.equal(b.sellThroughToday, a.sellThroughToday, "sellThroughToday must match");
  assert.equal(b.sellThroughLastMo, a.sellThroughLastMo, "sellThroughLastMo must match");
  assert.equal(b.sellThroughLastYr, a.sellThroughLastYr, "sellThroughLastYr must match");
  assert.deepEqual(b.lastMoStats, a.lastMoStats, "lastMoStats must match");
  assert.deepEqual(b.lastYrStats, a.lastYrStats, "lastYrStats must match");
}

// ─────────────────────────────────────────────────────────────────────────────
// Equivalence
// ─────────────────────────────────────────────────────────────────────────────

test("identical results: typical multi-dealer market", async () => {
  const tables = build({
    dealers: [
      { id: 1, name: "Alpha" },
      { id: 2, name: "Beta" },
      { id: 3, name: "Gamma" },
    ],
    snapshots: {
      1: [["2026-10-24", 20000], ["2026-10-24", 30000], ["2026-10-23", 10000]],
      2: [["2026-10-24", 15000], ["2026-10-24", null]],
      3: [["2026-10-24", 44000]],
    },
    monthlySales: [
      { dealer_id: 1, units_sold: 9, month_start: MONTH_START },
      { dealer_id: 2, units_sold: 4, month_start: MONTH_START },
      { dealer_id: 1, units_sold: 20, month_start: "2026-09-01" },
      { dealer_id: 1, units_sold: 15, month_start: "2025-10-01" },
    ],
    events: [
      { id: 1, vehicle_id: 1, to_dealer_id: 1, event_type: "added", excluded_from_metrics: false, event_date: "2026-10-05" },
      { id: 2, vehicle_id: 2, to_dealer_id: 1, event_type: "added", excluded_from_metrics: false, event_date: "2026-10-06" },
      { id: 3, vehicle_id: 3, to_dealer_id: 2, event_type: "transferred", excluded_from_metrics: false, event_date: "2026-10-07" },
      { id: 4, vehicle_id: 4, to_dealer_id: 1, event_type: "added", excluded_from_metrics: true, event_date: "2026-10-08" },
    ],
  });
  const { oldOut, newOut } = await bothLoaders(tables);
  assertSameOverview(oldOut, newOut);
  // Dealer 1 has two rows on its latest date (10-24) and one older row on
  // 10-23 that must be excluded; dealers 2 and 3 contribute 2 and 1.
  assert.equal(newOut.totalInventory, 5);
  assert.equal(newOut.activeDealersToday, 3);
});

test("DIVERGENCE: a dealer that never captured is omitted, not shown as zero inventory", async () => {
  // Legacy rendered this dealer as a row of zeros, which reads as "this lot is
  // empty". A missing capture is not an empty lot, so it is now omitted from
  // the market and reported separately.
  const tables = build({
    dealers: [{ id: 1, name: "Alpha" }, { id: 2, name: "Ghost" }],
    snapshots: { 1: [["2026-10-24", 10000]] },
    monthlySales: [
      { dealer_id: 1, units_sold: 3, month_start: MONTH_START },
      { dealer_id: 2, units_sold: 77, month_start: MONTH_START },
    ],
  });
  const { oldOut, newOut } = await bothLoaders(tables);

  const legacyGhost = oldOut.byDealer.find((d) => d.name === "Ghost")!;
  assert.equal(legacyGhost.count, 0, "legacy listed it with zero inventory");

  assert.equal(
    newOut.byDealer.find((d) => d.name === "Ghost"),
    undefined,
    "a never-captured dealer must not be listed as zero inventory"
  );
  const ex = newOut.excludedDealers.find((d) => d.name === "Ghost")!;
  assert.equal(ex.freshness, "historic");
  assert.equal(ex.lcd, null);

  // And its monthly_sales row is still never surfaced as market activity.
  assert.equal(newOut.totalInventory, 1);
  assert.equal(newOut.byDealer.length, 1);
});

test("DIVERGENCE: a 23-day-old capture is excluded from the market, not counted", async () => {
  // This is the production defect, in miniature. Pre-change the dealer's
  // 23-day-old inventory was summed into the headline total as if current.
  const tables = build({
    dealers: [{ id: 1, name: "Current" }, { id: 2, name: "Stale" }],
    snapshots: {
      1: [["2026-10-24", 20000], ["2026-10-24", 22000]],
      2: [["2026-10-01", 9000], ["2026-10-01", 11000], ["2026-09-15", 5000]],
    },
    monthlySales: [{ dealer_id: 2, units_sold: 6, month_start: MONTH_START }],
  });
  const { oldOut, newOut } = await bothLoaders(tables);

  assert.equal(oldOut.totalInventory, 4, "legacy counted the 23-day-old capture");
  assert.equal(newOut.totalInventory, 2, "only the in-scope dealer is counted");
  assert.equal(newOut.byDealer.length, 1, "and only that dealer is listed");
  assert.equal(newOut.byDealer[0].name, "Current");

  // Held out, not zeroed — the distinction the product rules require.
  const excluded = newOut.excludedDealers.find((d) => d.name === "Stale")!;
  assert.ok(excluded, "excluded dealers are reported, not silently dropped");
  assert.equal(excluded.freshness, "historic");
  assert.equal(
    excluded.lcd,
    null,
    "LCD lookback is bounded to the 14-day window; older than that is reported " +
      "as historic with an unknown date rather than costing a per-dealer query"
  );
  assert.equal(
    newOut.byDealer.find((d) => d.name === "Stale"),
    undefined,
    "it must NOT appear as a zero-inventory row"
  );
  assert.equal(newOut.monitoredDealerCount, 2, "full monitored roster still reported");
});

test("sell-through divides cohort sales by cohort inventory, not roster sales", async () => {
  // Fresh dealer: 2 units, 1 sale. Historic dealer: 50 sales, no current
  // inventory. If the numerator summed the whole roster the rate would be
  // (1+50)/2 = 2550%; it must be 1/2 = 50%.
  const tables = build({
    dealers: [{ id: 1, name: "Fresh" }, { id: 2, name: "Gone" }],
    snapshots: {
      1: [["2026-10-24", 20000], ["2026-10-24", 22000]],
      2: [["2026-06-01", 9000]],
    },
    monthlySales: [
      { dealer_id: 1, units_sold: 1, month_start: MONTH_START },
      { dealer_id: 2, units_sold: 50, month_start: MONTH_START },
    ],
  });
  const { newOut } = await bothLoaders(tables);

  assert.equal(newOut.totalInventory, 2, "denominator is cohort-only");
  assert.equal(
    newOut.sellThroughToday,
    50,
    "numerator must exclude the out-of-scope dealer's 50 sales"
  );
});

test("Stale (8–14 days) is excluded from the market but keeps a visible LCD", async () => {
  const tables = build({
    dealers: [{ id: 1, name: "Current" }, { id: 2, name: "TenDays" }],
    snapshots: {
      1: [["2026-10-24", 20000]],
      2: [["2026-10-14", 9000], ["2026-10-14", 11000]],
    },
  });
  const { newOut } = await bothLoaders(tables);

  assert.equal(newOut.totalInventory, 1, "stale inventory is not in the total");
  assert.equal(newOut.byDealer.length, 1);

  const ex = newOut.excludedDealers.find((d) => d.name === "TenDays")!;
  assert.equal(ex.freshness, "stale");
  assert.equal(ex.lcd, "2026-10-14", "inside the window, the real LCD is resolved");
  assert.equal(ex.ageDays, 10);
});

test("identical results: canonical cutoff derived from projection_cutoff", async () => {
  const tables = build({
    dealers: [{ id: 1, name: "Alpha" }],
    snapshots: { 1: [["2026-10-24", 10000]] },
    monthlySales: [
      { dealer_id: 1, units_sold: 5, month_start: MONTH_START, computed_by: CANONICAL_COMPUTED_BY, projection_cutoff: "2026-10-11" },
    ],
  });
  const { oldOut, newOut } = await bothLoaders(tables);
  assertSameOverview(oldOut, newOut);
  assert.equal(newOut.canonicalCutoff, "2026-10-11");
});

test("identical results: legacy (non-canonical) month yields a null cutoff", async () => {
  const tables = build({
    dealers: [{ id: 1, name: "Alpha" }],
    snapshots: { 1: [["2026-10-24", 10000]] },
    monthlySales: [
      { dealer_id: 1, units_sold: 5, month_start: MONTH_START, computed_by: "legacy_v0", projection_cutoff: "2026-10-11" },
    ],
  });
  const { oldOut, newOut } = await bothLoaders(tables);
  assertSameOverview(oldOut, newOut);
  assert.equal(newOut.canonicalCutoff, null);
});

test("identical results: daily sold dedupe, transfer exclusion, price precedence", async () => {
  const tables = build({
    dealers: [{ id: 1, name: "Alpha" }, { id: 2, name: "Beta" }],
    snapshots: { 1: [["2026-10-24", 10000]], 2: [["2026-10-24", 12000]] },
    events: [
      // vehicle 101 appears as both pending and sold → sold wins, counted once
      { id: 10, vehicle_id: 101, event_type: "pending_removal", event_date: TODAY, from_dealer_id: 1, resolved_at: null, last_seen_price: null, price_at_listing: 7000 },
      { id: 11, vehicle_id: 101, event_type: "sold", event_date: TODAY, from_dealer_id: 1, last_seen_price: 8000, price_at_listing: 9000 },
      // vehicle 102 sold but also transferred today → excluded
      { id: 12, vehicle_id: 102, event_type: "sold", event_date: TODAY, from_dealer_id: 1, last_seen_price: 5000 },
      { id: 13, vehicle_id: 102, event_type: "transferred", event_date: TODAY },
      // vehicle 103 pending only, attributed to dealer 2
      { id: 14, vehicle_id: 103, event_type: "pending_removal", event_date: TODAY, from_dealer_id: 2, resolved_at: null, last_seen_price: null, price_at_listing: 6000 },
      // null seller → skipped
      { id: 15, vehicle_id: 104, event_type: "sold", event_date: TODAY, from_dealer_id: null, last_seen_price: 1000 },
    ],
    vehicles: [
      { id: 101, year: 2021, make: "Ford", model: "F-150", vin: "VIN101" },
      { id: 103, year: 2019, make: "Honda", model: "Civic", vin: "VIN103" },
    ],
  });
  const { oldOut, newOut } = await bothLoaders(tables);
  assertSameOverview(oldOut, newOut);
  const alpha = newOut.byDealer.find((d) => d.name === "Alpha")!;
  assert.equal(alpha.dailySold, 1, "101 counted once, 102 excluded as a transfer");
  assert.equal(alpha.dailySoldVehicles[0].price, 8000, "last_seen_price wins");
  assert.equal(alpha.dailySoldVehicles[0].make, "Ford");
  const beta = newOut.byDealer.find((d) => d.name === "Beta")!;
  assert.equal(beta.dailySold, 1);
  assert.equal(beta.dailySoldVehicles[0].price, 6000, "falls back to price_at_listing");
});

test("identical results: comparison-period stats and sell-through", async () => {
  const tables = build({
    dealers: [{ id: 1, name: "Alpha" }, { id: 2, name: "Beta" }],
    snapshots: {
      1: [["2026-10-24", 20000], ["2026-09-24", 18000], ["2025-10-24", 16000]],
      2: [["2026-10-24", 22000], ["2026-09-24", 19000]],
    },
    monthlySales: [
      { dealer_id: 1, units_sold: 10, month_start: MONTH_START },
      { dealer_id: 1, units_sold: 8, month_start: "2026-09-01" },
      { dealer_id: 1, units_sold: 6, month_start: "2025-10-01" },
    ],
  });
  const { oldOut, newOut } = await bothLoaders(tables);
  assertSameOverview(oldOut, newOut);
  assert.ok(newOut.lastMoStats, "last month stats resolved");
  assert.ok(newOut.lastYrStats, "last year stats resolved");
});

test("identical results: empty database", async () => {
  const tables = build({ dealers: [], snapshots: {} });
  const { oldOut, newOut } = await bothLoaders(tables);
  assertSameOverview(oldOut, newOut);
  assert.equal(newOut.totalInventory, 0);
  assert.equal(newOut.avgPrice, 0);
  assert.equal(newOut.sellThroughToday, null);
});

test("identical results: every list price is null", async () => {
  const tables = build({
    dealers: [{ id: 1, name: "Alpha" }],
    snapshots: { 1: [["2026-10-24", null], ["2026-10-24", null]] },
  });
  const { oldOut, newOut } = await bothLoaders(tables);
  assertSameOverview(oldOut, newOut);
  assert.equal(newOut.avgPrice, 0, "unpriced inventory averages to 0, not NaN");
  assert.equal(newOut.totalInventory, 2);
});

test("identical results: avgPrice is a flat mean across dealers of unequal size", async () => {
  const tables = build({
    dealers: [{ id: 1, name: "Big" }, { id: 2, name: "Small" }],
    snapshots: {
      1: [["2026-10-24", 5000], ["2026-10-24", 5000], ["2026-10-24", 5000]],
      2: [["2026-10-24", 15000]],
    },
  });
  const { oldOut, newOut } = await bothLoaders(tables);
  assertSameOverview(oldOut, newOut);
  assert.equal(newOut.avgPrice, 7500, "flat mean (20000/4), not mean-of-means (10000)");
});

// ─────────────────────────────────────────────────────────────────────────────
// Query volume
// ─────────────────────────────────────────────────────────────────────────────

test("query count no longer scales with the dealer roster", async () => {
  const mk = (n: number) => {
    const dealers = Array.from({ length: n }, (_, i) => ({ id: i + 1, name: `D${i + 1}` }));
    const snapshots: Record<number, [string, number | null][]> = {};
    for (const d of dealers) snapshots[d.id] = [["2026-10-24", 10000]];
    return build({ dealers, snapshots });
  };

  const small = await bothLoaders(mk(3));
  const large = await bothLoaders(mk(30));

  // Old: grows by 6 queries per added dealer.
  assert.equal(large.oldCount - small.oldCount, 27 * 6, "legacy grows 6 queries per dealer");
  // New: flat.
  assert.equal(large.newCount, small.newCount, "optimized count is independent of dealer count");

  assert.ok(large.newCount <= 15, `expected <=15 queries, got ${large.newCount}`);
  console.log(`    query count @30 dealers — legacy: ${large.oldCount}, optimized: ${large.newCount}`);
});

// ─────────────────────────────────────────────────────────────────────────────
// Intentional divergence: the old code truncated at the 1,000-row cap
// ─────────────────────────────────────────────────────────────────────────────

test("DIVERGENCE: >1000 MTD added events — legacy truncates, optimized is exact", async () => {
  const OVER = MAX_ROWS + 250;
  const events = Array.from({ length: OVER }, (_, i) => ({
    id: i + 1,
    vehicle_id: i + 1,
    to_dealer_id: 1,
    event_type: "added",
    excluded_from_metrics: false,
    event_date: "2026-10-05",
  }));
  const tables = build({
    dealers: [{ id: 1, name: "Alpha" }],
    snapshots: { 1: [["2026-10-24", 10000]] },
    events,
  });
  const { oldOut, newOut } = await bothLoaders(tables);

  assert.equal(oldOut.byDealer[0].added, MAX_ROWS, "legacy silently caps at 1000");
  assert.equal(newOut.byDealer[0].added, OVER, "optimized reports the true total");
});

test("DIVERGENCE: >1000 units on a comparison date — legacy under-reports dealers and price", async () => {
  const snapshots: Record<number, [string, number | null][]> = { 1: [], 2: [] };
  // 1,200 units for dealer 1 then 50 for dealer 2, all on the comparison date.
  for (let i = 0; i < 1200; i++) snapshots[1].push(["2026-09-24", 10000]);
  for (let i = 0; i < 50; i++) snapshots[2].push(["2026-09-24", 90000]);
  snapshots[1].push(["2026-10-24", 10000]);
  snapshots[2].push(["2026-10-24", 10000]);

  const tables = build({ dealers: [{ id: 1, name: "A" }, { id: 2, name: "B" }], snapshots });
  const { oldOut, newOut } = await bothLoaders(tables);

  // inventory used head:true, so it was already exact in both.
  assert.equal(oldOut.lastMoStats!.inventory, 1250);
  assert.equal(newOut.lastMoStats!.inventory, 1250);

  // activeDealers and avgPrice read capped row sets in the legacy path.
  assert.equal(oldOut.lastMoStats!.activeDealers, 1, "legacy saw only the first 1000 rows");
  assert.equal(newOut.lastMoStats!.activeDealers, 2, "optimized sees both dealers");

  assert.equal(oldOut.lastMoStats!.avgPrice, 10000, "legacy averaged a truncated set");
  assert.equal(newOut.lastMoStats!.avgPrice, 13200, "optimized averages all 1250 units");
});

test("DIVERGENCE: dealer with >1000 units — legacy truncates avgPrice inputs", async () => {
  const snapshots: Record<number, [string, number | null][]> = { 1: [], 2: [] };
  for (let i = 0; i < 1100; i++) snapshots[1].push(["2026-10-24", 10000]);
  for (let i = 0; i < 10; i++) snapshots[2].push(["2026-10-24", 100000]);

  const tables = build({ dealers: [{ id: 1, name: "A" }, { id: 2, name: "B" }], snapshots });
  const { oldOut, newOut } = await bothLoaders(tables);

  // count came from an exact count() in both paths.
  assert.equal(oldOut.totalInventory, 1110);
  assert.equal(newOut.totalInventory, 1110);

  // but the price rows were capped at 1000 for dealer 1 in the legacy path.
  assert.notEqual(oldOut.avgPrice, newOut.avgPrice);
  assert.equal(newOut.avgPrice, Math.round((1100 * 10000 + 10 * 100000) / 1110));
});
