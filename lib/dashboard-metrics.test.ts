// Regression tests for the Market Overview aggregation helpers.
//
// These pin the behavior of the ORIGINAL inline implementation in
// app/dashboard/page.tsx so the set-based query rewrite underneath cannot
// silently change a displayed number. Every assertion here was derived by
// reading the pre-rewrite code, not the extracted module.

import { test } from "node:test";
import assert from "node:assert/strict";
import {
  deriveCanonicalCutoff,
  sumSoldForMonth,
  groupDailySoldByDealer,
  buildDealerRows,
  averageListPrice,
  aggregateSnapshotStats,
  sellThroughToday,
  sellThroughComparison,
  countActiveDealers,
  sumInventory,
  type MonthlySalesRow,
  type SnapshotMetricRow,
  type VehicleDetail,
} from "./dashboard-metrics.ts";
import { CANONICAL_COMPUTED_BY } from "./cutoff.ts";
import type { InventoryEvent } from "../types/index.ts";

const MONTH = "2026-10-01";
const PRIOR = "2026-09-01";

function ms(p: Partial<MonthlySalesRow> & { dealer_id: number }): MonthlySalesRow {
  return {
    units_sold: 0,
    month_start: MONTH,
    computed_by: null,
    projection_cutoff: null,
    ...p,
  };
}

function ev(p: Partial<InventoryEvent> & { vehicle_id: number }): InventoryEvent {
  return {
    id: p.vehicle_id,
    to_dealer_id: null,
    dealer_group_id: null,
    event_type: "sold",
    event_date: "2026-10-24",
    from_dealer_id: 1,
    old_price: null,
    new_price: null,
    price_at_listing: null,
    last_seen_price: null,
    last_seen_mileage: null,
    first_seen_date: null,
    ...p,
  } as InventoryEvent;
}

// ── deriveCanonicalCutoff ────────────────────────────────────────────────────

test("deriveCanonicalCutoff returns the cutoff from a canonical row in the month", () => {
  const rows = [
    ms({ dealer_id: 1, computed_by: "legacy", projection_cutoff: "2026-10-05" }),
    ms({ dealer_id: 2, computed_by: CANONICAL_COMPUTED_BY, projection_cutoff: "2026-10-11" }),
  ];
  assert.equal(deriveCanonicalCutoff(rows, MONTH), "2026-10-11");
});

test("deriveCanonicalCutoff ignores cutoffs on non-canonical rows", () => {
  const rows = [ms({ dealer_id: 1, computed_by: "legacy", projection_cutoff: "2026-10-05" })];
  assert.equal(deriveCanonicalCutoff(rows, MONTH), null);
});

test("deriveCanonicalCutoff ignores canonical rows from other months", () => {
  const rows = [
    ms({ dealer_id: 1, month_start: PRIOR, computed_by: CANONICAL_COMPUTED_BY, projection_cutoff: "2026-09-11" }),
  ];
  assert.equal(deriveCanonicalCutoff(rows, MONTH), null);
});

test("deriveCanonicalCutoff returns null for an empty set", () => {
  assert.equal(deriveCanonicalCutoff([], MONTH), null);
});

test("deriveCanonicalCutoff tolerates a canonical row with a null cutoff", () => {
  const rows = [
    ms({ dealer_id: 1, computed_by: CANONICAL_COMPUTED_BY, projection_cutoff: null }),
    ms({ dealer_id: 2, computed_by: CANONICAL_COMPUTED_BY, projection_cutoff: "2026-10-09" }),
  ];
  assert.equal(deriveCanonicalCutoff(rows, MONTH), "2026-10-09");
});

// ── sumSoldForMonth ──────────────────────────────────────────────────────────

test("sumSoldForMonth sums only the requested month", () => {
  const rows = [
    ms({ dealer_id: 1, units_sold: 10 }),
    ms({ dealer_id: 2, units_sold: 5 }),
    ms({ dealer_id: 3, units_sold: 99, month_start: PRIOR }),
  ];
  assert.equal(sumSoldForMonth(rows, MONTH), 15);
  assert.equal(sumSoldForMonth(rows, PRIOR), 99);
});

test("sumSoldForMonth treats null units_sold as zero", () => {
  const rows = [ms({ dealer_id: 1, units_sold: null }), ms({ dealer_id: 2, units_sold: 7 })];
  assert.equal(sumSoldForMonth(rows, MONTH), 7);
});

test("sumSoldForMonth returns 0 when the month is absent", () => {
  assert.equal(sumSoldForMonth([ms({ dealer_id: 1, units_sold: 3 })], "2020-01-01"), 0);
});

// ── groupDailySoldByDealer ───────────────────────────────────────────────────

test("groupDailySoldByDealer groups by from_dealer_id and counts", () => {
  const vehicles = new Map<number, VehicleDetail>([
    [10, { year: 2020, make: "Ford", model: "F-150", vin: "VIN10", mileage: 1000 }],
  ]);
  const out = groupDailySoldByDealer(
    [ev({ vehicle_id: 10, from_dealer_id: 1 }), ev({ vehicle_id: 11, from_dealer_id: 1 }), ev({ vehicle_id: 12, from_dealer_id: 2 })],
    vehicles
  );
  assert.equal(out.get(1)?.count, 2);
  assert.equal(out.get(2)?.count, 1);
  assert.equal(out.get(1)?.vehicles[0].make, "Ford");
});

test("groupDailySoldByDealer skips events with a null from_dealer_id", () => {
  const out = groupDailySoldByDealer([ev({ vehicle_id: 10, from_dealer_id: null })], new Map());
  assert.equal(out.size, 0);
});

test("groupDailySoldByDealer prefers last_seen_price over price_at_listing", () => {
  const out = groupDailySoldByDealer(
    [ev({ vehicle_id: 10, last_seen_price: 1500, price_at_listing: 9999 })],
    new Map()
  );
  assert.equal(out.get(1)?.vehicles[0].price, 1500);
});

test("groupDailySoldByDealer falls back to price_at_listing, then null", () => {
  const withListing = groupDailySoldByDealer(
    [ev({ vehicle_id: 10, last_seen_price: null, price_at_listing: 2500 })],
    new Map()
  );
  assert.equal(withListing.get(1)?.vehicles[0].price, 2500);

  const neither = groupDailySoldByDealer(
    [ev({ vehicle_id: 10, last_seen_price: null, price_at_listing: null })],
    new Map()
  );
  assert.equal(neither.get(1)?.vehicles[0].price, null);
});

test("groupDailySoldByDealer nulls vehicle detail when the vehicle is unknown", () => {
  const out = groupDailySoldByDealer([ev({ vehicle_id: 999 })], new Map());
  const v = out.get(1)!.vehicles[0];
  assert.equal(v.year, null);
  assert.equal(v.make, null);
  assert.equal(v.vin, null);
  assert.equal(v.mileage, null);
  assert.equal(v.trim, null, "trim is always blank — matches the DBRAIN email");
});

// ── buildDealerRows ──────────────────────────────────────────────────────────

const DEALERS = [
  { id: 1, name: "Alpha" },
  { id: 2, name: "Beta" },
];

test("buildDealerRows assembles counts, sold, added and transferred", () => {
  const rows = buildDealerRows(
    DEALERS,
    new Map([[1, 42], [2, 7]]),
    [ms({ dealer_id: 1, units_sold: 9 }), ms({ dealer_id: 2, units_sold: 3 })],
    MONTH,
    new Map([[1, 5]]),
    new Map([[2, 2]]),
    new Map()
  );
  assert.deepEqual(
    rows.map((r) => [r.name, r.count, r.sold, r.added, r.transferred]),
    [["Alpha", 42, 9, 5, 0], ["Beta", 7, 3, 0, 2]]
  );
});

test("REGRESSION: a dealer with no snapshot reports sold 0 even when monthly_sales has a row", () => {
  // The original early-returned before reading monthly_sales. A dealer absent
  // from inventoryByDealer must therefore show 0 sold, not its real units_sold.
  const rows = buildDealerRows(
    DEALERS,
    new Map([[1, 10]]), // Beta has no snapshot
    [ms({ dealer_id: 2, units_sold: 25 })],
    MONTH,
    new Map([[2, 4]]),
    new Map([[2, 4]]),
    new Map()
  );
  const beta = rows.find((r) => r.name === "Beta")!;
  assert.equal(beta.count, 0);
  assert.equal(beta.sold, 0, "sold must stay 0 for a dealer with no snapshot");
  assert.equal(beta.added, 0, "added must stay 0 for a dealer with no snapshot");
  assert.equal(beta.transferred, 0);
});

test("buildDealerRows still reports dailySold for a dealer with no snapshot", () => {
  // dailySold was computed before the early return, so it survives it.
  const daily = new Map([[2, { count: 3, vehicles: [] }]]);
  const rows = buildDealerRows(DEALERS, new Map([[1, 10]]), [], MONTH, new Map(), new Map(), daily);
  const beta = rows.find((r) => r.name === "Beta")!;
  assert.equal(beta.count, 0);
  assert.equal(beta.dailySold, 3);
});

test("buildDealerRows treats a zero-count snapshot dealer as present", () => {
  // Present in the map with 0 means "has snapshots, none today" — still reads
  // monthly_sales, unlike an absent dealer.
  const rows = buildDealerRows(
    [{ id: 1, name: "Alpha" }],
    new Map([[1, 0]]),
    [ms({ dealer_id: 1, units_sold: 12 })],
    MONTH,
    new Map(),
    new Map(),
    new Map()
  );
  assert.equal(rows[0].count, 0);
  assert.equal(rows[0].sold, 12);
});

test("buildDealerRows matches monthly_sales on dealer_id AND month", () => {
  const rows = buildDealerRows(
    [{ id: 1, name: "Alpha" }],
    new Map([[1, 5]]),
    [ms({ dealer_id: 1, units_sold: 99, month_start: PRIOR })],
    MONTH,
    new Map(),
    new Map(),
    new Map()
  );
  assert.equal(rows[0].sold, 0, "a prior-month row must not leak into this month");
});

test("buildDealerRows treats a null units_sold as 0", () => {
  const rows = buildDealerRows(
    [{ id: 1, name: "Alpha" }],
    new Map([[1, 5]]),
    [ms({ dealer_id: 1, units_sold: null })],
    MONTH,
    new Map(),
    new Map(),
    new Map()
  );
  assert.equal(rows[0].sold, 0);
});

// ── averageListPrice ─────────────────────────────────────────────────────────

test("averageListPrice is a flat mean over rows, not a mean of per-dealer means", () => {
  // Dealer 1 has three cheap cars, dealer 2 one expensive one. A mean-of-means
  // would give 15000; the flat mean is 7500.
  const rows: SnapshotMetricRow[] = [
    { dealer_id: 1, list_price: 5000 },
    { dealer_id: 1, list_price: 5000 },
    { dealer_id: 1, list_price: 5000 },
    { dealer_id: 2, list_price: 15000 },
  ];
  assert.equal(averageListPrice(rows), 7500);
});

test("averageListPrice skips null prices and rounds", () => {
  const rows: SnapshotMetricRow[] = [
    { dealer_id: 1, list_price: 1000 },
    { dealer_id: 1, list_price: null },
    { dealer_id: 1, list_price: 1001 },
  ];
  assert.equal(averageListPrice(rows), 1001); // 2001/2 = 1000.5 → 1001
});

test("averageListPrice returns 0 (not null) when nothing is priced", () => {
  assert.equal(averageListPrice([{ dealer_id: 1, list_price: null }]), 0);
  assert.equal(averageListPrice([]), 0);
});

test("averageListPrice does NOT apply the >500 floor used elsewhere", () => {
  // Locations/Compare filter list_price > 500; the Market Overview average
  // never did. Pin that difference.
  assert.equal(averageListPrice([{ dealer_id: 1, list_price: 100 }]), 100);
});

// ── aggregateSnapshotStats ───────────────────────────────────────────────────

test("aggregateSnapshotStats counts distinct dealers, all rows, and priced mean", () => {
  const rows: SnapshotMetricRow[] = [
    { dealer_id: 1, list_price: 1000 },
    { dealer_id: 1, list_price: 2000 },
    { dealer_id: 2, list_price: null },
  ];
  assert.deepEqual(aggregateSnapshotStats(rows), {
    activeDealers: 2,
    inventory: 3,
    avgPrice: 1500,
  });
});

test("aggregateSnapshotStats returns avgPrice null when nothing is priced", () => {
  const stats = aggregateSnapshotStats([{ dealer_id: 1, list_price: null }]);
  assert.equal(stats.avgPrice, null);
  assert.equal(stats.inventory, 1);
  assert.equal(stats.activeDealers, 1);
});

test("aggregateSnapshotStats on an empty set is all-zero with a null price", () => {
  assert.deepEqual(aggregateSnapshotStats([]), {
    activeDealers: 0,
    inventory: 0,
    avgPrice: null,
  });
});

test("aggregateSnapshotStats counts unpriced rows in inventory", () => {
  const rows: SnapshotMetricRow[] = [
    { dealer_id: 1, list_price: 500 },
    { dealer_id: 1, list_price: null },
  ];
  assert.equal(aggregateSnapshotStats(rows).inventory, 2);
  assert.equal(aggregateSnapshotStats(rows).avgPrice, 500);
});

// ── sell-through ─────────────────────────────────────────────────────────────

test("sellThroughToday is a percentage, or null without inventory", () => {
  assert.equal(sellThroughToday(25, 100), 25);
  assert.equal(sellThroughToday(0, 100), 0);
  assert.equal(sellThroughToday(5, 0), null);
});

test("sellThroughComparison requires stats, inventory > 0 AND sold > 0", () => {
  assert.equal(sellThroughComparison({ activeDealers: 1, inventory: 200, avgPrice: 1 }, 50), 25);
  assert.equal(sellThroughComparison(null, 50), null);
  assert.equal(
    sellThroughComparison({ activeDealers: 1, inventory: 0, avgPrice: 1 }, 50),
    null,
    "zero inventory → null"
  );
  assert.equal(
    sellThroughComparison({ activeDealers: 1, inventory: 200, avgPrice: 1 }, 0),
    null,
    "zero sold → null, NOT 0 — this asymmetry with sellThroughToday is intentional"
  );
});

// ── totals ───────────────────────────────────────────────────────────────────

test("countActiveDealers counts only dealers with inventory", () => {
  const rows = buildDealerRows(
    [{ id: 1, name: "A" }, { id: 2, name: "B" }, { id: 3, name: "C" }],
    new Map([[1, 5], [2, 0]]),
    [],
    MONTH,
    new Map(),
    new Map(),
    new Map()
  );
  assert.equal(countActiveDealers(rows), 1);
  assert.equal(sumInventory(rows), 5);
});

test("sumInventory over an empty set is 0", () => {
  assert.equal(sumInventory([]), 0);
  assert.equal(countActiveDealers([]), 0);
});
