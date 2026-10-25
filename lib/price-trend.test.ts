// The server-side 7-day price window that replaced
// /api/dealer/[id]/price-trend?days=7.
//
// `legacyRouteTrend` below reimplements the deleted route's arithmetic exactly
// (group by snapshot_date, mean of non-null list_price, round; the component
// then took avg/min/max of those daily means). Every case asserts the new
// implementation produces the identical figures, so the displayed numbers are
// unchanged by the removal of the fan-out.

import { test } from "node:test";
import assert from "node:assert/strict";
import { buildPriceTrends, loadPriceTrends, type PriceTrendRow } from "./price-trend.ts";
import { FakePostgrest, MAX_ROWS } from "./fake-postgrest.ts";

/** Faithful port of the deleted API route + the old component's maths. */
function legacyRouteTrend(rows: { snapshot_date: string; list_price: number | null }[]) {
  const priced = rows.filter((r) => r.list_price != null);
  if (priced.length === 0) return null;
  const byDate = new Map<string, number[]>();
  for (const r of priced) {
    if (!byDate.has(r.snapshot_date)) byDate.set(r.snapshot_date, []);
    byDate.get(r.snapshot_date)!.push(r.list_price as number);
  }
  const data = [...byDate.entries()]
    .map(([date, prices]) => ({
      date,
      price: Math.round(prices.reduce((a, b) => a + b, 0) / prices.length),
    }))
    .sort((a, b) => a.date.localeCompare(b.date));
  const prices = data.map((d) => d.price);
  return {
    avg: Math.round(prices.reduce((a, b) => a + b, 0) / prices.length),
    min: Math.min(...prices),
    max: Math.max(...prices),
    dailyAverages: prices,
  };
}

const ROWS: PriceTrendRow[] = [
  { dealer_id: 1, snapshot_date: "2026-10-20", list_price: 10000 },
  { dealer_id: 1, snapshot_date: "2026-10-20", list_price: 20000 }, // mean 15000
  { dealer_id: 1, snapshot_date: "2026-10-21", list_price: 30001 }, // mean 30001
  { dealer_id: 1, snapshot_date: "2026-10-22", list_price: 9000 },
  { dealer_id: 1, snapshot_date: "2026-10-22", list_price: 9001 }, // mean 9001 (rounds .5 up)
  { dealer_id: 2, snapshot_date: "2026-10-22", list_price: 50000 },
  { dealer_id: 3, snapshot_date: "2026-10-22", list_price: null }, // unpriced only
];

test("REQUIRED 8: matches the deleted per-dealer API route exactly", () => {
  const trends = buildPriceTrends(ROWS);

  for (const dealerId of [1, 2, 3]) {
    const legacy = legacyRouteTrend(ROWS.filter((r) => r.dealer_id === dealerId));
    const next = trends.get(dealerId) ?? null;
    if (legacy === null) {
      assert.equal(next, null, `dealer ${dealerId}: both produce no data`);
      continue;
    }
    assert.deepEqual(next!.dailyAverages, legacy.dailyAverages, `dealer ${dealerId} dailies`);
    assert.equal(next!.avg, legacy.avg, `dealer ${dealerId} avg`);
    assert.equal(next!.min, legacy.min, `dealer ${dealerId} min`);
    assert.equal(next!.max, legacy.max, `dealer ${dealerId} max`);
  }
});

test("daily means are averaged per DAY, then avg/min/max taken across days", () => {
  const t = buildPriceTrends(ROWS).get(1)!;
  assert.deepEqual(t.dailyAverages, [15000, 30001, 9001], "oldest first");
  assert.equal(t.min, 9001);
  assert.equal(t.max, 30001);
  assert.equal(t.avg, Math.round((15000 + 30001 + 9001) / 3));
});

test("a dealer with only unpriced rows yields no trend (renders 'No data')", () => {
  assert.equal(buildPriceTrends(ROWS).get(3), undefined);
  assert.equal(buildPriceTrends([]).size, 0);
});

test("null list_price rows never contribute to a day's mean", () => {
  const t = buildPriceTrends([
    { dealer_id: 1, snapshot_date: "2026-10-22", list_price: 1000 },
    { dealer_id: 1, snapshot_date: "2026-10-22", list_price: null },
  ]).get(1)!;
  assert.deepEqual(t.dailyAverages, [1000], "the null is skipped, not treated as 0");
});

test("one set-based read replaces the per-dealer fan-out", async () => {
  const dealers = Array.from({ length: 20 }, (_, i) => i + 1);
  const snaps = dealers.flatMap((id) => [
    { id: `a${id}`, dealer_id: id, snapshot_date: "2026-10-24", list_price: 10000 + id },
    { id: `b${id}`, dealer_id: id, snapshot_date: "2026-10-23", list_price: 20000 + id },
  ]);
  const db = new FakePostgrest({ inventory_snapshots: snaps });

  const trends = await loadPriceTrends(db, dealers, "2026-10-25");

  assert.equal(trends.size, 20, "every dealer resolved");
  assert.ok(
    db.queryCount <= 2,
    `expected a head-count plus one page for 20 dealers, got ${db.queryCount}`
  );
  const t = trends.get(7)!;
  assert.deepEqual(t.dailyAverages, [20007, 10007], "oldest first across both days");
});

test("the window read is paged — a dealer above the 1,000-row cap is not truncated", async () => {
  // 1,300 priced rows on one day for one dealer. An unpaged read would see
  // only the first 1,000 and compute the mean over a truncated set.
  const OVER = MAX_ROWS + 300;
  const snaps = Array.from({ length: OVER }, (_, i) => ({
    id: `s${i}`,
    dealer_id: 1,
    snapshot_date: "2026-10-24",
    // first 1,000 rows are 10,000; the rest are 20,000 so truncation is visible
    list_price: i < MAX_ROWS ? 10000 : 20000,
  }));
  const db = new FakePostgrest({ inventory_snapshots: snaps });

  const t = (await loadPriceTrends(db, [1], "2026-10-25")).get(1)!;

  const expected = Math.round((MAX_ROWS * 10000 + 300 * 20000) / OVER);
  assert.equal(t.dailyAverages[0], expected, "mean covers all 1,300 rows");
  assert.notEqual(t.dailyAverages[0], 10000, "a truncated read would have given exactly 10000");
  assert.ok(db.queryCount > 1, "more than one page was fetched");
});

test("dealers outside the requested cohort are never loaded", async () => {
  const db = new FakePostgrest({
    inventory_snapshots: [
      { id: "a", dealer_id: 1, snapshot_date: "2026-10-24", list_price: 1000 },
      { id: "b", dealer_id: 99, snapshot_date: "2026-10-24", list_price: 9999 },
    ],
  });
  const trends = await loadPriceTrends(db, [1], "2026-10-25");
  assert.equal(trends.size, 1);
  assert.equal(trends.get(99), undefined, "an out-of-scope dealer contributes nothing");
});

test("an empty cohort issues no query at all", async () => {
  const db = new FakePostgrest({ inventory_snapshots: [] });
  const trends = await loadPriceTrends(db, [], "2026-10-25");
  assert.equal(trends.size, 0);
  assert.equal(db.queryCount, 0);
});
