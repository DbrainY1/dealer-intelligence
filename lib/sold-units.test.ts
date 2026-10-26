// The shared sold-units provider: verified vs estimated, and the group
// de-duplication safeguard applied to totals.

import { test } from "node:test";
import assert from "node:assert/strict";
import { loadSoldUnits, sumSoldUnits, formatSoldCell, isFeedDealer } from "./sold-units.ts";
import { FakePostgrest } from "./fake-postgrest.ts";
import { dateRange } from "./estimated-departures.ts";

const NOW = new Date("2026-10-25T20:00:00Z"); // 2026-10-25 Pacific
const OCT = dateRange("2026-10-01", "2026-10-25");

/** Feed snapshots: dealers 1-3 hold a filler plus optional departing VINs. */
function snaps(spec: Record<number, Record<number, string[]>>) {
  const out: Record<string, unknown>[] = [];
  let i = 0;
  for (const [d, vins] of Object.entries(spec))
    for (const [v, dates] of Object.entries(vins))
      for (const date of dates)
        out.push({ id: `s${i++}`, dealer_id: Number(d), snapshot_date: date, vehicle_id: Number(v) });
  return out;
}

test("feed dealers are 1/2/3; everyone else is verified", () => {
  assert.equal(isFeedDealer(1), true);
  assert.equal(isFeedDealer(3), true);
  assert.equal(isFeedDealer(5), false);
});

test("verified dealers read monthly_sales; feed dealers read the estimator", async () => {
  const db = new FakePostgrest({
    monthly_sales: [
      { id: 1, dealer_id: 5, month_start: "2026-10-01", units_sold: 8 },
      { id: 2, dealer_id: 6, month_start: "2026-10-01", units_sold: 0 },
    ],
    inventory_snapshots: snaps({
      1: { 9999: OCT, 100: OCT.filter((d) => d <= "2026-10-20") }, // 1 departure
      2: { 9999: OCT },
      3: { 9999: OCT },
    }),
  });

  const r = await loadSoldUnits(db, [1, 2, 3, 5, 6], NOW);

  assert.equal(r.byDealer.get(5)!.units, 8);
  assert.equal(r.byDealer.get(5)!.basis, "verified");
  assert.equal(r.byDealer.get(6)!.units, 0, "a real verified zero stays zero");

  assert.equal(r.byDealer.get(1)!.basis, "estimated");
  assert.equal(r.byDealer.get(1)!.units, 1, "the departing VIN becomes an estimated sale");
  assert.equal(r.byDealer.get(2)!.units, 0, "a feed dealer with no departures estimates 0");
  assert.deepEqual(r.estimatedDealerIds.sort(), [1, 2, 3]);
});

test("a verified dealer with no monthly_sales row stays unknown, not zero", async () => {
  const db = new FakePostgrest({ monthly_sales: [], inventory_snapshots: [] });
  const r = await loadSoldUnits(db, [5], NOW);
  assert.equal(r.byDealer.get(5), undefined);
  assert.deepEqual(formatSoldCell(r.byDealer.get(5)), { text: "—", isEstimate: false });
});

test("formatSoldCell flags estimates and preserves the dash for unknowns", () => {
  assert.deepEqual(
    formatSoldCell({ dealerId: 1, units: 24, basis: "estimated", pending: 2, undated: 10, departedVins: [], pendingVins: [] }),
    { text: "24", isEstimate: true },
  );
  assert.deepEqual(
    formatSoldCell({ dealerId: 5, units: 0, basis: "verified", pending: 0, undated: 0, departedVins: [], pendingVins: [] }),
    { text: "0", isEstimate: false },
  );
  assert.deepEqual(formatSoldCell(undefined), { text: "—", isEstimate: false });
});

test("the period is month-to-date for BOTH populations", async () => {
  const db = new FakePostgrest({
    monthly_sales: [
      { id: 1, dealer_id: 5, month_start: "2026-10-01", units_sold: 8 },
      { id: 2, dealer_id: 5, month_start: "2026-09-01", units_sold: 99 }, // prior month
    ],
    inventory_snapshots: snaps({ 1: { 9999: OCT }, 2: { 9999: OCT }, 3: { 9999: OCT } }),
  });
  const r = await loadSoldUnits(db, [1, 5], NOW);
  assert.equal(r.monthStart, "2026-10-01");
  assert.equal(r.through, "2026-10-25");
  assert.equal(r.byDealer.get(5)!.units, 8, "September must not leak in");
});

test("sumSoldUnits adds verified and estimated, reporting each", async () => {
  const db = new FakePostgrest({
    monthly_sales: [{ id: 1, dealer_id: 5, month_start: "2026-10-01", units_sold: 8 }],
    inventory_snapshots: snaps({
      1: { 9999: OCT, 100: OCT.filter((d) => d <= "2026-10-20") },
      2: { 9999: OCT, 200: OCT.filter((d) => d <= "2026-10-19") },
      3: { 9999: OCT },
    }),
  });
  const r = await loadSoldUnits(db, [1, 2, 3, 5], NOW);
  const s = sumSoldUnits(r, [1, 2, 3, 5]);
  assert.equal(s.verified, 8);
  assert.equal(s.estimated, 2);
  assert.equal(s.total, 10);
  assert.equal(s.deduplicatedBy, 0, "no cross-store overlap in this fixture");
});

test("the group de-duplication safeguard removes a cross-store double count", async () => {
  // VIN 500 is listed at BOTH dealer 1 and dealer 2, then leaves. Each store
  // reports an inventory-origin departure, but only one vehicle left.
  const upTo = OCT.filter((d) => d <= "2026-10-18");
  const db = new FakePostgrest({
    monthly_sales: [],
    inventory_snapshots: snaps({
      1: { 9999: OCT, 500: upTo },
      2: { 9999: OCT, 500: upTo },
      3: { 9999: OCT },
    }),
  });
  const r = await loadSoldUnits(db, [1, 2, 3], NOW);
  assert.equal(r.byDealer.get(1)!.units, 1, "store 1 reports its origin departure");
  assert.equal(r.byDealer.get(2)!.units, 1, "store 2 reports its origin departure");

  const s = sumSoldUnits(r, [1, 2, 3]);
  assert.equal(s.deduplicatedBy, 1, "the overlap is removed from the total");
  assert.equal(s.estimated, 1, "group total counts the vehicle once");
  assert.equal(s.total, 1);
});

test("de-duplication is skipped for a partial selection of the group", async () => {
  const upTo = OCT.filter((d) => d <= "2026-10-18");
  const db = new FakePostgrest({
    monthly_sales: [],
    inventory_snapshots: snaps({
      1: { 9999: OCT, 500: upTo },
      2: { 9999: OCT, 500: upTo },
      3: { 9999: OCT },
    }),
  });
  const r = await loadSoldUnits(db, [1, 2, 3], NOW);
  const partial = sumSoldUnits(r, [1]); // only one store selected
  assert.equal(partial.deduplicatedBy, 0, "a whole-group figure must not be applied to a subset");
  assert.equal(partial.estimated, 1);
});

test("the feed set can be overridden, so fixtures need not collide with ids 1-3", async () => {
  const db = new FakePostgrest({
    monthly_sales: [{ id: 1, dealer_id: 1, month_start: "2026-10-01", units_sold: 42 }],
    inventory_snapshots: [],
  });
  const r = await loadSoldUnits(db, [1], NOW, []); // no feed dealers
  assert.equal(r.byDealer.get(1)!.basis, "verified");
  assert.equal(r.byDealer.get(1)!.units, 42);
  assert.deepEqual(r.estimatedDealerIds, []);
});

test("feed dealers never read monthly_sales", async () => {
  const db = new FakePostgrest({
    monthly_sales: [{ id: 1, dealer_id: 1, month_start: "2026-10-01", units_sold: 999 }],
    inventory_snapshots: snaps({ 1: { 9999: OCT }, 2: { 9999: OCT }, 3: { 9999: OCT } }),
  });
  const r = await loadSoldUnits(db, [1], NOW);
  assert.equal(r.byDealer.get(1)!.units, 0, "the stray monthly_sales row is ignored");
  assert.equal(r.byDealer.get(1)!.basis, "estimated");
});

// ── estimator reuse (no duplicate execution) ────────────────────────────────

test("a preloaded report is reused instead of re-running the estimator", async () => {
  const snapRows = snaps({
    1: { 9999: OCT, 100: OCT.filter((d) => d <= "2026-10-20") },
    2: { 9999: OCT },
    3: { 9999: OCT },
  });

  // First: no preload — the provider runs the estimator itself.
  const dbCold = new FakePostgrest({ monthly_sales: [], inventory_snapshots: snapRows });
  const cold = await loadSoldUnits(dbCold, [1, 2, 3], NOW);
  const coldQueries = dbCold.queryCount;
  assert.ok(coldQueries > 0);

  // Then: hand it the report a page already loaded.
  const { loadEstimatedDepartures, HOMENET_FEED } = await import("./estimated-departures-data.ts");
  const dbWarm = new FakePostgrest({ monthly_sales: [], inventory_snapshots: snapRows });
  const report = await loadEstimatedDepartures(dbWarm, HOMENET_FEED, NOW);
  const afterReport = dbWarm.queryCount;
  const warm = await loadSoldUnits(dbWarm, [1, 2, 3], NOW, undefined, report);
  const warmExtra = dbWarm.queryCount - afterReport;

  assert.equal(warmExtra, 0, `preloaded path must issue no estimator queries, issued ${warmExtra}`);
  assert.deepEqual(
    [...warm.byDealer.values()].map((s) => s.units),
    [...cold.byDealer.values()].map((s) => s.units),
    "and must produce identical figures",
  );
});

test("departed and pending VINs are surfaced through the provider", async () => {
  const db = new FakePostgrest({
    monthly_sales: [],
    inventory_snapshots: snaps({
      1: { 9999: OCT, 100: OCT.filter((d) => d <= "2026-10-20"), 101: OCT.filter((d) => d <= "2026-10-24") },
      2: { 9999: OCT },
      3: { 9999: OCT },
    }),
  });
  const r = await loadSoldUnits(db, [1, 2, 3], NOW);
  const s = r.byDealer.get(1)!;
  assert.equal(s.units, 1);
  assert.equal(s.departedVins.length, 1, "list length matches the published figure");
  assert.equal(s.departedVins[0].vehicleId, 100);
  assert.equal(s.pendingVins.length, 1);
  assert.equal(s.pendingVins[0].vehicleId, 101);
});

test("verified dealers expose empty VIN lists, never estimator data", async () => {
  const db = new FakePostgrest({
    monthly_sales: [{ id: 1, dealer_id: 5, month_start: "2026-10-01", units_sold: 8 }],
    inventory_snapshots: [],
  });
  const r = await loadSoldUnits(db, [5], NOW);
  assert.deepEqual(r.byDealer.get(5)!.departedVins, []);
  assert.deepEqual(r.byDealer.get(5)!.pendingVins, []);
});
