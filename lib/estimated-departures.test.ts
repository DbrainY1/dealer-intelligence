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

// ── group roll-up: unique VINs, no cross-store double counting ───────────────

test("CROSS-STORE: a VIN listed at two stores at once is counted once for the group", () => {
  // VIN 500 sits at BOTH dealer 1 and dealer 2 for the same dates, then
  // vanishes from both. Each store legitimately reports an inventory-origin
  // departure, so the per-dealer sum is 2 — but only one vehicle left.
  const upTo = ALL.filter((d) => d <= "2026-10-15");
  const r = run(rows({ 1: { 500: upTo }, 2: { 500: upTo } }));

  assert.equal(r.totals.estimatedDepartures, 2, "per-dealer sum double-counts by design");
  assert.equal(r.group.estimatedDepartures, 1, "the group counts the VIN once");
  assert.equal(r.group.perDealerSum, 2);
  assert.equal(r.group.crossStoreDuplicatesRemoved, 1);
});

test("CROSS-STORE: a transfer between stores is not a group departure at all", () => {
  const r = run(
    rows({
      1: { 600: ALL.filter((d) => d <= "2026-10-10") },
      2: { 600: ALL.filter((d) => d >= "2026-10-11") },
    }),
  );
  assert.equal(r.totals.estimatedDepartures, 0, "excluded as a transfer at the origin store");
  assert.equal(r.group.estimatedDepartures, 0, "and the vehicle never left the group");
  assert.equal(r.group.retained > 0, true);
});

test("CROSS-STORE: a VIN that transfers then leaves counts exactly once", () => {
  const r = run(
    rows({
      1: { 700: ALL.filter((d) => d <= "2026-10-10") },
      2: { 700: ALL.filter((d) => d >= "2026-10-11" && d <= "2026-10-18") },
    }),
  );
  assert.equal(r.totals.estimatedDepartures, 1, "counted only at the store it left from");
  assert.equal(r.group.estimatedDepartures, 1, "and once for the group");
  assert.equal(r.group.crossStoreDuplicatesRemoved, 0);
});

test("CROSS-STORE: independent departures at different stores both count", () => {
  const r = run(
    rows({
      1: { 800: ALL.filter((d) => d <= "2026-10-12") },
      2: { 810: ALL.filter((d) => d <= "2026-10-14") },
      3: { 820: ALL.filter((d) => d <= "2026-10-16") },
    }),
  );
  assert.equal(r.group.estimatedDepartures, 3, "three distinct vehicles left the group");
  assert.equal(r.group.perDealerSum, 3);
  assert.equal(r.group.crossStoreDuplicatesRemoved, 0);
});

test("group evidence uses only days when EVERY store captured", () => {
  // Dealer 3 is dark from 10-20 onward, so 10-21..25 are not group-complete.
  const d3days = ALL.filter((d) => d <= "2026-10-20");
  const r = run([
    ...bareRows({ 1: { [FILLER]: ALL }, 2: { [FILLER]: ALL } }),
    ...bareRows({ 3: { [FILLER]: d3days } }),
  ]);
  assert.equal(r.group.groupValidDays, 20, "10-01..10-20 only");
  assert.equal(r.group.coverage.complete, false);
});

test("a store with no data at all does not block group evidence", () => {
  const r = run(bareRows({ 1: { [FILLER]: ALL, 900: ALL.filter((d) => d <= "2026-10-10") } }));
  assert.equal(r.group.groupValidDays, 25, "dealers 2 and 3 never participated");
  assert.equal(r.group.estimatedDepartures, 1);
});

test("group departures are not dated across the blackout", () => {
  const r = run(rows({ 1: { 950: ["2026-10-01", "2026-10-02", "2026-10-03"] } }, VALID));
  assert.equal(r.group.estimatedDepartures, 1);
  assert.equal(r.group.confirmedUndated, 1, "vanished into the gap — no date asserted");
  assert.equal(r.group.confirmedDated, 0);
});

test("group honours the 72-hour rule", () => {
  const r = run(rows({ 1: { 960: ALL.filter((d) => d <= "2026-10-23") } }));
  assert.equal(r.group.estimatedDepartures, 0, "only 2 group-valid days of absence");
  assert.equal(r.group.pendingConfirmation, 1);
});

test("group total never exceeds the per-dealer sum", () => {
  const r = run(
    rows({
      1: { 970: ALL.filter((d) => d <= "2026-10-11"), 971: ALL.filter((d) => d <= "2026-10-12") },
      2: { 970: ALL.filter((d) => d <= "2026-10-11") },
      3: { 972: ALL.filter((d) => d <= "2026-10-13") },
    }),
  );
  assert.ok(
    r.group.estimatedDepartures <= r.group.perDealerSum,
    "de-duplication can only remove, never add",
  );
  assert.equal(r.group.estimatedDepartures, 3, "970 once, plus 971 and 972");
  assert.equal(r.group.perDealerSum, 4);
  assert.equal(r.group.crossStoreDuplicatesRemoved, 1);
});

// ── VIN exposure: reconciliation, prices, pending exclusions ────────────────

/** Rows carrying an advertised price, for the VIN-detail cases. */
function pricedRows(
  spec: Record<number, Record<number, [string, number | null][]>>,
  captureDays: string[] = ALL,
): FeedSnapshotRow[] {
  const out: FeedSnapshotRow[] = [];
  for (const d of GROUP)
    for (const date of captureDays)
      out.push({ dealer_id: d, snapshot_date: date, vehicle_id: FILLER, list_price: 1 });
  for (const [d, vins] of Object.entries(spec))
    for (const [v, pairs] of Object.entries(vins))
      for (const [date, price] of pairs)
        out.push({ dealer_id: Number(d), snapshot_date: date, vehicle_id: Number(v), list_price: price });
  return out;
}

test("VIN list length always equals the published count", () => {
  const r = run(
    rows({
      1: {
        100: ALL.filter((d) => d <= "2026-10-12"),
        101: ALL.filter((d) => d <= "2026-10-14"),
        102: ALL.filter((d) => d <= "2026-10-24"), // pending, only 1 day absent
      },
    }),
  );
  const x = d1(r);
  assert.equal(x.departedVins.length, x.estimatedDepartures, "confirmed list matches the count");
  assert.equal(x.pendingVins.length, x.pendingConfirmation, "pending list matches the count");
  assert.equal(x.departedVins.length, 2);
  assert.equal(x.pendingVins.length, 1);
  assert.deepEqual(x.departedVins.map((v) => v.vehicleId).sort(), [100, 101]);
  assert.deepEqual(x.pendingVins.map((v) => v.vehicleId), [102]);
});

test("each departed VIN carries its LAST advertised price", () => {
  const r = run(
    pricedRows({
      1: {
        100: [
          ["2026-10-01", 30000],
          ["2026-10-02", 28000],
          ["2026-10-03", 26500], // last seen → this is the price reported
        ],
      },
    }),
  );
  const v = d1(r).departedVins.find((x) => x.vehicleId === 100)!;
  assert.equal(v.lastAdvertisedPrice, 26500, "the most recent advertised price wins");
  assert.equal(v.lastSeen, "2026-10-03");
});

test("a never-advertised vehicle reports a null price, never 0", () => {
  const r = run(pricedRows({ 1: { 100: [["2026-10-01", null], ["2026-10-02", null]] } }));
  const v = d1(r).departedVins.find((x) => x.vehicleId === 100)!;
  assert.equal(v.lastAdvertisedPrice, null, "null, so callers can exclude it from the average");
  assert.notEqual(v.lastAdvertisedPrice, 0);
});

test("departed VINs record whether the departure is datable", () => {
  const r = run(
    pricedRows({ 1: { 100: [["2026-10-01", 1000], ["2026-10-02", 1000], ["2026-10-03", 1000]] } }, VALID),
  );
  const v = d1(r).departedVins.find((x) => x.vehicleId === 100)!;
  assert.equal(v.dated, false, "it vanished into the blackout");
  assert.equal(v.lastSeen, "2026-10-03", "but the last sighting is still known");
});

test("pending VINs respect the transfer exclusion", () => {
  // VIN 300 leaves store 1 yesterday and appears at store 2 — a transfer, so
  // it must not sit in store 1's pending list awaiting confirmation.
  const r = run(
    rows({
      1: { 300: ALL.filter((d) => d <= "2026-10-24") },
      2: { 300: ["2026-10-25"] },
    }),
  );
  assert.equal(d1(r).excludedTransfer, 1);
  assert.equal(d1(r).pendingVins.length, 0, "a transfer is never pending confirmation");
  assert.equal(d1(r).departedVins.length, 0);
});

test("pending VINs exclude vehicles still present on the last capture", () => {
  const r = run(rows({ 1: { 400: ALL } }));
  assert.equal(d1(r).pendingVins.length, 0, "retained vehicles are not pending");
  assert.equal(d1(r).retained, 2);
});

test("confirmed and pending lists are disjoint", () => {
  const r = run(
    rows({
      1: { 500: ALL.filter((d) => d <= "2026-10-10"), 501: ALL.filter((d) => d <= "2026-10-24") },
    }),
  );
  const x = d1(r);
  const confirmed = new Set(x.departedVins.map((v) => v.vehicleId));
  for (const p of x.pendingVins) {
    assert.equal(confirmed.has(p.vehicleId), false, `VIN ${p.vehicleId} is in both lists`);
  }
  assert.equal(x.departedVins.length + x.pendingVins.length, 2);
});

test("advertised-price aggregation excludes missing prices rather than zeroing them", () => {
  const r = run(
    pricedRows({
      1: {
        100: [["2026-10-01", 20000], ["2026-10-02", 20000]],
        101: [["2026-10-01", null], ["2026-10-02", null]], // never advertised
        102: [["2026-10-01", 40000], ["2026-10-02", 40000]],
      },
    }),
  );
  const vins = d1(r).departedVins;
  assert.equal(vins.length, 3, "all three departed");

  const priced = vins.map((v) => v.lastAdvertisedPrice).filter((p): p is number => p != null);
  assert.equal(priced.length, 2, "only two carry an advertised price");
  const avg = priced.reduce((a, b) => a + b, 0) / priced.length;
  assert.equal(avg, 30000, "average over priced vehicles only");
  assert.notEqual(avg, 20000, "a $0 substitution would have given 20000");
});
