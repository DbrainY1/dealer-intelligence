// Estimated Departures — confirmation, exclusions, coverage and feed failure.

import { test } from "node:test";
import assert from "node:assert/strict";
import {
  computeEstimatedDepartures,
  dateRange,
  type FeedSnapshotRow,
} from "./estimated-departures.ts";

const GROUP = [1, 2, 3];
const START = "2026-10-01";
const END = "2026-10-25";

const ALL = dateRange(START, END);

/**
 * Build rows: `{ dealerId: { vin: [dates] } }`.
 *
 * Every dealer also gets a long-lived filler VIN on `captureDays`. A dealer's
 * capture days are inferred from the rows it produced, so without resident
 * inventory the dealer would look like it stopped capturing the moment its
 * only test VIN left — and the code would (correctly) refuse to infer a
 * departure from silence. Real lots always hold stock, so the filler makes the
 * fixtures behave like production.
 */
const FILLER = 9999;
function rows(
  spec: Record<number, Record<number, string[]>>,
  captureDays: string[] = ALL,
): FeedSnapshotRow[] {
  const out: FeedSnapshotRow[] = [];
  for (const d of GROUP)
    for (const date of captureDays)
      out.push({ dealer_id: d, snapshot_date: date, vehicle_id: FILLER });
  for (const [d, vins] of Object.entries(spec))
    for (const [v, dates] of Object.entries(vins))
      for (const date of dates)
        out.push({ dealer_id: Number(d), snapshot_date: date, vehicle_id: Number(v) });
  return out;
}

/** Rows with NO filler, for cases that test capture-day inference itself. */
function bareRows(spec: Record<number, Record<number, string[]>>): FeedSnapshotRow[] {
  const out: FeedSnapshotRow[] = [];
  for (const [d, vins] of Object.entries(spec))
    for (const [v, dates] of Object.entries(vins))
      for (const date of dates)
        out.push({ dealer_id: Number(d), snapshot_date: date, vehicle_id: Number(v) });
  return out;
}

const run = (r: FeedSnapshotRow[], windowEnd = END) =>
  computeEstimatedDepartures(r, { feedDealerIds: GROUP, windowStart: START, windowEnd });

const d1 = (rep: ReturnType<typeof run>) => rep.perDealer.find((d) => d.dealerId === 1)!;

// ── confirmation rule ────────────────────────────────────────────────────────

test("a VIN absent for 3+ captured days is confirmed and dated", () => {
  // last seen 10-22, captured 23/24/25 after it → 3 valid days
  const r = run(rows({ 1: { 100: ALL.filter((d) => d <= "2026-10-22") } }));
  assert.equal(d1(r).confirmedDated, 1);
  assert.equal(d1(r).confirmedUndated, 0);
  assert.equal(d1(r).pendingConfirmation, 0);
  assert.equal(d1(r).estimatedDepartures, 1);
});

test("a VIN absent for fewer than 3 captured days stays pending", () => {
  const r = run(rows({ 1: { 100: ALL.filter((d) => d <= "2026-10-23") } }));
  assert.equal(d1(r).pendingConfirmation, 1, "only 2 valid days of absence");
  assert.equal(d1(r).estimatedDepartures, 0);
});

test("a VIN present on the final capture day is retained, not departed", () => {
  const r = run(rows({ 1: { 100: ALL } }));
  assert.equal(d1(r).retained, 2, "VIN 100 plus the filler");
  assert.equal(d1(r).estimatedDepartures, 0);
  assert.equal(d1(r).pendingConfirmation, 0);
});

test("elapsed time alone is not enough — absence must be backed by real captures", () => {
  // Only 2 capture days exist in the whole window, both early. A VIN last seen
  // on day 1 has 25 days of elapsed time but only 1 captured day of absence.
  const r = run(bareRows({ 1: { 100: ["2026-10-01"], 200: ["2026-10-01", "2026-10-02"] } }));
  assert.equal(d1(r).confirmedDated, 0, "silence is not evidence of absence");
  assert.equal(d1(r).confirmedUndated, 0);
  assert.equal(d1(r).pendingConfirmation, 1);
});

// ── exclusions ───────────────────────────────────────────────────────────────

test("a VIN reappearing at a sibling feed dealer is a transfer, not a departure", () => {
  const r = run(
    rows({
      1: { 100: ALL.filter((d) => d <= "2026-10-10") },
      2: { 100: ALL.filter((d) => d >= "2026-10-11") },
    }),
  );
  assert.equal(d1(r).excludedTransfer, 1);
  assert.equal(d1(r).estimatedDepartures, 0);
  assert.equal(r.totals.estimatedDepartures, 0, "and it is not counted at the receiving dealer");
});

test("a VIN that leaves and returns to the same dealer is flagged as a relist", () => {
  const dates = ALL.filter((d) => d <= "2026-10-05" || d >= "2026-10-12");
  const r = run(rows({ 1: { 100: dates } }));
  assert.equal(d1(r).excludedRelist, 0, "it is still present at the end, so not a departure");
  assert.equal(d1(r).retained, 2, "VIN 100 plus the filler");

  // Same pattern but it leaves for good afterwards: relist is recorded AND the
  // final departure is still evaluated.
  const gone = ALL.filter((d) => d <= "2026-10-05" || (d >= "2026-10-12" && d <= "2026-10-20"));
  const r2 = run(rows({ 1: { 100: gone } }));
  assert.equal(d1(r2).excludedRelist, 1, "the mid-window return is recorded");
  assert.equal(d1(r2).estimatedDepartures, 1, "and the final departure still counts once");
});

test("duplicate VIN rows on the same dealer-day are counted once", () => {
  const r = run([
    ...rows({ 1: { 100: ["2026-10-01", "2026-10-02"] } }),
    { dealer_id: 1, snapshot_date: "2026-10-01", vehicle_id: 100 }, // duplicate row
  ]);
  assert.equal(d1(r).duplicateVinRows, 1, "the duplicate row is tallied");
  assert.equal(d1(r).estimatedDepartures, 1, "VIN 100 counted once, not twice");
});

// ── mid-window arrivals, counted once ────────────────────────────────────────

test("a VIN first seen mid-window and then departing is counted exactly once", () => {
  const r = run(rows({ 1: { 100: ["2026-10-17", "2026-10-18", "2026-10-19"] } }));
  assert.equal(d1(r).estimatedDepartures, 1);
  assert.equal(d1(r).ofWhichArrivedMidWindow, 1, "reported as a mid-window arrival");
  assert.equal(d1(r).confirmedDated, 1);
});

test("baseline and mid-window cohorts never double-count", () => {
  const r = run(
    rows({
      1: {
        100: ALL.filter((d) => d <= "2026-10-10"), // present day one, departs
        200: ["2026-10-17", "2026-10-18"], // arrives mid-window, departs
      },
    }),
  );
  assert.equal(d1(r).estimatedDepartures, 2);
  assert.equal(d1(r).ofWhichArrivedMidWindow, 1, "only VIN 200 arrived mid-window");
});

// ── the Oct 4–15 blackout: confirm, but never invent a date ──────────────────

const GAP_DAYS = dateRange("2026-10-04", "2026-10-15");
const VALID = ALL.filter((d) => !GAP_DAYS.includes(d));

test("a VIN lost across the blackout is confirmed but NOT dated", () => {
  const r = run(rows({ 1: { 100: ["2026-10-01", "2026-10-02", "2026-10-03"] } }, VALID));
  const x = d1(r);
  assert.equal(x.confirmedUndated, 1, "10 post-gap capture days prove it is gone");
  assert.equal(x.confirmedDated, 0, "but the day after it was last seen was never captured");
  assert.equal(x.estimatedDepartures, 1);
});

test("a VIN departing inside a fully captured stretch IS dated", () => {
  const r = run(rows({ 1: { 100: VALID.filter((d) => d <= "2026-10-18") } }, VALID));
  assert.equal(d1(r).confirmedDated, 1);
  assert.equal(d1(r).confirmedUndated, 0);
});

test("coverage reports the blackout as a single contiguous gap", () => {
  const r = run(rows({ 1: { 100: VALID }, 2: { 200: VALID }, 3: { 300: VALID } }, VALID));
  const cov = d1(r).coverage;
  assert.equal(cov.expectedDays, 25);
  assert.equal(cov.presentDays, 13);
  assert.equal(cov.complete, false);
  assert.equal(cov.gaps.length, 1);
  assert.deepEqual(cov.gaps[0], { start: "2026-10-04", end: "2026-10-15", days: 12 });
  assert.equal(r.coverageComplete, false);
});

test("a missing day is never read as a departure", () => {
  // Every VIN is present on every captured day; the gap must produce nothing.
  const r = run(rows({ 1: { 100: VALID, 200: VALID, 300: VALID } }, VALID));
  assert.equal(d1(r).estimatedDepartures, 0);
  assert.equal(d1(r).pendingConfirmation, 0);
  assert.equal(d1(r).retained, 4, "3 VINs plus the filler");
});

// ── feed failure warning ─────────────────────────────────────────────────────

test("a feed that sent nothing on the final expected day raises a failure", () => {
  const upToYesterday = ALL.filter((d) => d <= "2026-10-24");
  const r = run([
    ...bareRows({ 1: { 100: upToYesterday, [FILLER]: upToYesterday } }),
    ...bareRows({ 2: { 200: ALL, [FILLER]: ALL }, 3: { 300: ALL, [FILLER]: ALL } }),
  ]);
  assert.deepEqual(r.feedFailures, [1], "only dealer 1 is down");
  assert.equal(d1(r).coverage.feedFailedOnLastExpectedDay, true);
});

test("a down feed does not manufacture departures for its vehicles", () => {
  const upToYesterday = ALL.filter((d) => d <= "2026-10-24");
  const r = run(
    bareRows({
      1: { 100: upToYesterday, [FILLER]: upToYesterday },
      2: { 200: ALL }, 3: { 300: ALL },
    }),
  );
  assert.deepEqual(r.feedFailures, [1]);
  assert.equal(
    d1(r).estimatedDepartures,
    0,
    "VIN 100 was present on the last capture — a dead feed is not a departure",
  );
  assert.equal(d1(r).retained, 2, "VIN 100 plus the filler");
});

test("no feed failure when every dealer reported on the final day", () => {
  const r = run(rows({ 1: { 100: ALL }, 2: { 200: ALL }, 3: { 300: ALL } }));
  assert.deepEqual(r.feedFailures, []);
  assert.equal(r.coverageComplete, true);
});

// ── totals and isolation ─────────────────────────────────────────────────────

test("totals sum the per-dealer figures", () => {
  const r = run(
    rows({
      1: { 100: ["2026-10-01"], 110: ALL },
      2: { 200: ["2026-10-02"], 210: ALL },
      3: { 300: ALL },
    }),
  );
  const sum = r.perDealer.reduce((a, d) => a + d.estimatedDepartures, 0);
  assert.equal(r.totals.estimatedDepartures, sum);
  assert.equal(sum, 2);
});

test("rows for dealers outside the feed group are ignored", () => {
  const r = run([
    ...bareRows({ 1: { 100: ALL } }),
    { dealer_id: 99, snapshot_date: "2026-10-01", vehicle_id: 500 },
  ]);
  assert.equal(r.perDealer.length, 3, "only the three feed dealers are reported");
  assert.equal(r.totals.estimatedDepartures, 0);
});

test("an empty window produces zeros, not errors", () => {
  const r = run([]);
  assert.equal(r.totals.estimatedDepartures, 0);
  assert.equal(r.perDealer.length, 3);
  assert.equal(r.perDealer[0].coverage.presentDays, 0);
});
