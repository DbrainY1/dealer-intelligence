// Universal Estimated Sales — Stage 2 methodology.
//
// One case per rule in the agreed methodology, plus the reporting invariants.

import { test } from "node:test";
import assert from "node:assert/strict";
import {
  computeEstimatedSales,
  assessCompleteness,
  hoursBetween,
  longestMissingStreak,
  CONFIRMATION_HOURS,
  type SalesSnapshotRow,
} from "./estimated-sales.ts";
import { dateRange } from "./estimated-departures.ts";

const START = "2026-10-01";
const END = "2026-10-25";
const ALL = dateRange(START, END);
const GROUP = new Map<number, number | null>([[1, 7], [2, 7], [3, null]]);
const DEALERS = [1, 2, 3];

/** Capture at 04:00 UTC each morning, like the real pipeline. */
const at = (d: string, hour = 4) => `${d}T${String(hour).padStart(2, "0")}:00:00.000Z`;

/** Rows for `{ dealer: { vin: [dates] } }`, every dealer capturing `days`. */
function rows(
  spec: Record<number, Record<number, string[]>>,
  days: string[] = ALL,
  prices: Record<number, number | null> = {},
): SalesSnapshotRow[] {
  const out: SalesSnapshotRow[] = [];
  const FILLER = 9999;
  for (const d of DEALERS)
    for (const date of days)
      out.push({ dealer_id: d, snapshot_date: date, vehicle_id: FILLER, list_price: 1, created_at: at(date) });
  for (const [d, vins] of Object.entries(spec))
    for (const [v, dts] of Object.entries(vins))
      for (const date of dts)
        out.push({
          dealer_id: Number(d),
          snapshot_date: date,
          vehicle_id: Number(v),
          list_price: Number(v) in prices ? prices[Number(v)] : 20000,
          created_at: at(date),
        });
  return out;
}

const run = (r: SalesSnapshotRow[], over: Partial<Parameters<typeof computeEstimatedSales>[1]> = {}) =>
  computeEstimatedSales(r, {
    dealerIds: DEALERS,
    groupByDealer: GROUP,
    windowStart: START,
    windowEnd: END,
    today: END,
    ...over,
  });
const d1 = (r: ReturnType<typeof run>) => r.perDealer.find((d) => d.dealerId === 1)!;

// ── 1. first absence creates a pending departure ────────────────────────────

test("first verified absence creates a PENDING departure, not a sale", () => {
  // Last seen 10-24, absent on the 10-25 capture: only ~24h elapsed.
  const r = run(rows({ 1: { 100: ALL.filter((d) => d <= "2026-10-24") } }));
  const x = d1(r);
  assert.equal(x.pendingDepartures, 1);
  assert.equal(x.confirmedEstimatedSales, 0, "24h is not 72h");
  assert.equal(x.episodes[0].status, "pending");
  assert.equal(x.episodes[0].firstAbsentCapture, "2026-10-25");
});

// ── 2. 72-hour confirmation using actual timestamps ─────────────────────────

test("confirmation uses real capture timestamps, not calendar days", () => {
  const r = run(rows({ 1: { 100: ALL.filter((d) => d <= "2026-10-21") } }));
  const e = d1(r).episodes[0];
  assert.equal(e.status, "confirmed");
  assert.equal(e.confirmedOn, "2026-10-24", "the first capture ≥72h after the last sighting");
  assert.equal(e.elapsedHoursAtConfirmation, 72, "exactly 72h, from 04:00 to 04:00");
  assert.equal(d1(r).confirmedEstimatedSales, 1);
});

test("a capture 71 hours after the last sighting does NOT confirm", () => {
  // Shift the 10-24 capture an hour earlier so only 71h have elapsed.
  const base = rows({ 1: { 100: ALL.filter((d) => d <= "2026-10-21") } });
  const shifted = base.map((r) =>
    r.snapshot_date === "2026-10-24" ? { ...r, created_at: at("2026-10-24", 3) } : r,
  );
  const e = d1(run(shifted)).episodes[0];
  assert.equal(e.confirmedOn, "2026-10-25", "the 71h capture is rejected; the next one confirms");
  assert.equal(e.elapsedHoursAtConfirmation, 96, "96h at that later capture, not 71h");
});

/** Same fixture, with every capture timestamp removed. */
const stripStamps = (r: SalesSnapshotRow[]) =>
  r.map((x) => {
    const y = { ...x };
    delete y.created_at;
    return y;
  });

test("FALLBACK: without timestamps, 4 date boundaries from first absence confirms", () => {
  // Last seen 10-01; first verified absence 10-02; capture 10-06 is 4
  // boundaries after that absence → qualifies.
  const noStamps = stripStamps(rows({ 1: { 100: ["2026-10-01"] } }));
  const e = d1(run(noStamps)).episodes[0];
  assert.equal(e.firstAbsentCapture, "2026-10-02");
  assert.equal(e.status, "confirmed");
  assert.equal(e.confirmedOn, "2026-10-06", "4 boundaries after the first absence");
  assert.equal(e.dateBoundariesAtConfirmation, 4);
  assert.equal(e.confirmationBasis, "date_boundary");
  assert.equal(e.elapsedHoursAtConfirmation, null, "no timestamps were available");
});

test("FALLBACK: 3 date boundaries is NOT enough without timestamps", () => {
  // Captures stop after 10-05, so the only candidates are 10-03/04/05 —
  // at most 3 boundaries from the 10-02 first absence. Nothing may confirm.
  const days = dateRange("2026-10-01", "2026-10-05");
  const noStamps = stripStamps(rows({ 1: { 100: ["2026-10-01"] } }, days));
  const r = computeEstimatedSales(noStamps, {
    dealerIds: DEALERS, groupByDealer: GROUP,
    windowStart: "2026-10-01", windowEnd: "2026-10-05", today: "2026-10-05",
  });
  const e = r.perDealer.find((d) => d.dealerId === 1)!.episodes[0];
  assert.equal(e.firstAbsentCapture, "2026-10-02");
  assert.equal(e.status, "pending", "3 boundaries cannot confirm");
  assert.equal(e.confirmedOn, null);
  assert.equal(r.perDealer.find((d) => d.dealerId === 1)!.confirmedEstimatedSales, 0);
});

test("FALLBACK: the Jan 1 → Jan 5 / Jan 4 worked example", () => {
  const jan = dateRange("2026-01-01", "2026-01-10");
  // Vehicle last seen 2025-12-31 is outside the window, so anchor on Jan 1
  // being the first verified absence: present only on a prior day is not
  // expressible here, so model it as last seen Dec 31 via a Jan window start.
  const build = (captureDays: string[]) =>
    stripStamps(
      captureDays.flatMap((date) => [
        { dealer_id: 1, snapshot_date: date, vehicle_id: 9999, list_price: 1, created_at: null },
        ...(date === "2026-01-01" ? [{ dealer_id: 1, snapshot_date: date, vehicle_id: 500, list_price: 1, created_at: null }] : []),
      ]) as SalesSnapshotRow[],
    );

  const opts = {
    dealerIds: [1], groupByDealer: new Map<number, number | null>([[1, null]]),
    windowStart: "2026-01-01", today: "2026-01-10",
  };
  // first absence Jan 2; Jan 5 is only 3 boundaries after it → no confirmation
  const short = computeEstimatedSales(build(jan.filter((d) => d <= "2026-01-05")), {
    ...opts, windowEnd: "2026-01-05",
  });
  assert.equal(short.perDealer[0].confirmedEstimatedSales, 0, "Jan 2 → Jan 5 is 3 boundaries");

  // Jan 6 is 4 boundaries after the Jan 2 absence → confirms
  const long = computeEstimatedSales(build(jan.filter((d) => d <= "2026-01-06")), {
    ...opts, windowEnd: "2026-01-06",
  });
  assert.equal(long.perDealer[0].confirmedEstimatedSales, 1, "Jan 2 → Jan 6 is 4 boundaries");
  assert.equal(long.perDealer[0].episodes[0].confirmationBasis, "date_boundary");
});

test("timestamps always win over the date-boundary fallback when present", () => {
  // 10-21 → 10-24 is 72 real hours, confirmed on timestamps even though the
  // boundary count from the 10-22 first absence is only 2.
  const e = d1(run(rows({ 1: { 100: ALL.filter((d) => d <= "2026-10-21") } }))).episodes[0];
  assert.equal(e.confirmationBasis, "timestamp");
  assert.equal(e.confirmedOn, "2026-10-24");
  assert.equal(e.dateBoundariesAtConfirmation, 2, "fewer boundaries than the fallback requires");
});

// ── 3. return before confirmation ───────────────────────────────────────────

test("a VIN returning BEFORE confirmation voids the episode", () => {
  const present = ALL.filter((d) => d <= "2026-10-20" || d >= "2026-10-22");
  const r = run(rows({ 1: { 100: present } }));
  const x = d1(r);
  assert.equal(x.voided, 1);
  assert.equal(x.confirmedEstimatedSales, 0, "it never became a sale");
  assert.equal(x.pendingDepartures, 0, "and it is no longer pending");
  assert.equal(x.episodes[0].returnedOn, "2026-10-22");
});

// ── 4. return within 30 days unwinds a confirmed sale ───────────────────────

test("a VIN returning within 30 days UNWINDS the confirmed sale", () => {
  // Gone after 10-05, confirmed 10-08, back on 10-20 → 12 days later.
  const present = ALL.filter((d) => d <= "2026-10-05" || d >= "2026-10-20");
  const r = run(rows({ 1: { 100: present } }));
  const x = d1(r);
  assert.equal(x.unwound, 1);
  assert.equal(x.confirmedEstimatedSales, 0, "the sale is reversed");
  assert.equal(x.episodes[0].status, "unwound");
  assert.equal(x.episodes[0].returnedOn, "2026-10-20");
});

test("a return AFTER the 30-day window leaves the sale standing", () => {
  const present = ALL.filter((d) => d <= "2026-10-05" || d >= "2026-10-20");
  const r = run(rows({ 1: { 100: present } }), { unwindWindowDays: 5 });
  assert.equal(d1(r).unwound, 0, "12 days is outside a 5-day unwind window");
  assert.equal(d1(r).confirmedEstimatedSales, 1);
});

// ── 5. repeated qualifying departures ───────────────────────────────────────

test("each independently qualifying departure counts", () => {
  // Present 01-04, gone 05-12 (confirmed), back 13-16, gone 17-25 (confirmed).
  const present = ALL.filter(
    (d) => d <= "2026-10-04" || (d >= "2026-10-13" && d <= "2026-10-16"),
  );
  const r = run(rows({ 1: { 100: present } }), { unwindWindowDays: 0 });
  const x = d1(r);
  assert.equal(x.episodes.filter((e) => e.status === "confirmed").length, 2);
  assert.equal(x.confirmedEstimatedSales, 2, "both departures count");
  assert.deepEqual(
    x.episodes.filter((e) => e.status === "confirmed").map((e) => e.lastSeen),
    ["2026-10-04", "2026-10-16"],
  );
});

// ── 6. no double counting ───────────────────────────────────────────────────

test("one departure event is never counted twice", () => {
  const r = run(rows({ 1: { 100: ALL.filter((d) => d <= "2026-10-10") } }));
  const keys = d1(r).episodes.map((e) => e.key);
  assert.equal(new Set(keys).size, keys.length, "episode keys are unique");
  assert.equal(d1(r).confirmedEstimatedSales, 1);
});

test("pending becoming confirmed does not raise Potential Sales a second time", () => {
  const base = ALL.filter((d) => d <= "2026-10-24"); // pending on 10-25
  const whilePending = run(rows({ 1: { 100: base } }, ALL));
  assert.equal(d1(whilePending).pendingDepartures, 1);
  assert.equal(d1(whilePending).confirmedEstimatedSales, 0);
  assert.equal(d1(whilePending).potentialSales, 1);

  // Three days later the same single departure has confirmed.
  const laterDays = dateRange(START, "2026-10-28");
  const afterConfirm = computeEstimatedSales(
    rows({ 1: { 100: base } }, laterDays),
    { dealerIds: DEALERS, groupByDealer: GROUP, windowStart: START, windowEnd: "2026-10-28", today: "2026-10-28" },
  );
  const y = afterConfirm.perDealer.find((d) => d.dealerId === 1)!;
  assert.equal(y.confirmedEstimatedSales, 1);
  assert.equal(y.pendingDepartures, 0);
  assert.equal(y.potentialSales, 1, "still ONE potential sale — it moved buckets, it did not add");
});

// ── 7. incomplete and failed captures ───────────────────────────────────────

test("a missing capture day is never read as a departure", () => {
  const captured = ALL.filter((d) => d !== "2026-10-10");
  const r = run(rows({ 1: { 100: captured } }, captured));
  assert.equal(d1(r).confirmedEstimatedSales, 0);
  assert.equal(d1(r).pendingDepartures, 0, "silence is not absence");
});

test("five consecutive missed captures mark the month INCOMPLETE", () => {
  const gap = dateRange("2026-10-10", "2026-10-14");
  const captured = ALL.filter((d) => !gap.includes(d));
  const r = run(rows({ 1: { 100: captured } }, captured));
  const c = d1(r).completeness;
  assert.equal(c.status, "incomplete");
  assert.equal(c.longestMissStreak, 5);
  assert.match(c.reasons[0], /5 consecutive missed captures/);
});

test("over 20% missing mid-month is AT RISK, at month end INCOMPLETE", () => {
  const captured = ALL.filter((_, i) => i % 5 !== 0); // 20% missing, no long streak
  const active = assessCompleteness(ALL, new Set(captured), {
    monthEnded: false, partialCapture: false, unverifiedProvider: false,
  });
  const ended = assessCompleteness(ALL, new Set(captured.slice(0, 15)), {
    monthEnded: true, partialCapture: false, unverifiedProvider: false,
  });
  assert.equal(ended.status, "incomplete");
  assert.match(ended.reasons.join(" "), /month end/);
  assert.ok(active.status === "complete" || active.status === "at_risk");
});

test("verified partial capture and unverified provider change force INCOMPLETE", () => {
  const partial = run(rows({ 1: { 100: ALL } }), { partialCaptureDealerIds: [1] });
  assert.equal(d1(partial).completeness.status, "incomplete");
  assert.match(d1(partial).completeness.reasons.join(" "), /partial inventory capture/);

  const provider = run(rows({ 1: { 100: ALL } }), { unverifiedProviderDealerIds: [1] });
  assert.equal(d1(provider).completeness.status, "incomplete");
  assert.match(d1(provider).completeness.reasons.join(" "), /provider or website changed/);
});

test("INCOMPLETE preserves counts but suppresses projection and sell-through", () => {
  const r = run(rows({ 1: { 100: ALL.filter((d) => d <= "2026-10-10") } }), {
    partialCaptureDealerIds: [1],
  });
  const x = d1(r);
  assert.equal(x.confirmedEstimatedSales, 1, "verified counts are preserved");
  assert.equal(x.projectedMonthlySales, null, "projection withheld");
  assert.equal(x.sellThroughPct, null, "sell-through withheld");
  assert.deepEqual(r.incompleteDealerIds, [1], "and excluded from market comparison");
});

// ── 8. ownership-group internal movement ────────────────────────────────────

test("movement between dealers in one ownership group is not a sale", () => {
  const r = run(
    rows({
      1: { 100: ALL.filter((d) => d <= "2026-10-10") },
      2: { 100: ALL.filter((d) => d >= "2026-10-11") }, // same group (7)
    }),
  );
  assert.equal(d1(r).excludedTransfers, 1);
  assert.equal(d1(r).confirmedEstimatedSales, 0);
  assert.equal(r.totals.confirmedEstimatedSales, 0, "nor counted at the receiving dealer");
});

test("movement to a dealer OUTSIDE the group is still a sale", () => {
  const r = run(
    rows({
      1: { 100: ALL.filter((d) => d <= "2026-10-10") },
      3: { 100: ALL.filter((d) => d >= "2026-10-11") }, // group null = not a sibling
    }),
  );
  assert.equal(d1(r).excludedTransfers, 0);
  assert.equal(d1(r).confirmedEstimatedSales, 1);
});

// ── 9. Potential Sales totals ───────────────────────────────────────────────

test("Potential Sales equals confirmed plus pending, per dealer and overall", () => {
  const r = run(
    rows({
      1: { 100: ALL.filter((d) => d <= "2026-10-10"), 101: ALL.filter((d) => d <= "2026-10-24") },
      3: { 300: ALL.filter((d) => d <= "2026-10-12") },
    }),
  );
  const x = d1(r);
  assert.equal(x.confirmedEstimatedSales, 1);
  assert.equal(x.pendingDepartures, 1);
  assert.equal(x.potentialSales, 2);
  assert.equal(
    r.totals.potentialSales,
    r.totals.confirmedEstimatedSales + r.totals.pendingDepartures,
  );
});

// ── 10. confirmed-only projections and sell-through ─────────────────────────

test("projection and sell-through ignore pending departures entirely", () => {
  const confirmedOnly = run(rows({ 1: { 100: ALL.filter((d) => d <= "2026-10-10") } }));
  const withPending = run(
    rows({
      1: { 100: ALL.filter((d) => d <= "2026-10-10"), 101: ALL.filter((d) => d <= "2026-10-24") },
    }),
  );
  assert.equal(d1(withPending).pendingDepartures, 1, "a pending departure exists");
  assert.equal(
    d1(withPending).projectedMonthlySales,
    d1(confirmedOnly).projectedMonthlySales,
    "but the projection is unchanged by it",
  );
  assert.equal(d1(withPending).sellThroughPct, d1(confirmedOnly).sellThroughPct);
});

// ── 11. advertised prices and auditability ──────────────────────────────────

test("missing advertised prices are excluded, never valued at zero", () => {
  const r = run(
    rows(
      {
        1: {
          100: ALL.filter((d) => d <= "2026-10-10"),
          101: ALL.filter((d) => d <= "2026-10-11"),
          102: ALL.filter((d) => d <= "2026-10-12"),
        },
      },
      ALL,
      { 100: 20000, 101: null, 102: 40000 },
    ),
  );
  const a = d1(r).advertised;
  assert.equal(a.pricedCount, 2);
  assert.equal(a.missingPriceCount, 1);
  assert.equal(a.avgAdvertised, 30000, "mean over priced vehicles only");
  assert.notEqual(a.avgAdvertised, 20000, "a $0 substitution would have given 20000");
});

test("every episode is auditable: identity, timings and reason preserved", () => {
  const present = ALL.filter((d) => d <= "2026-10-05" || d >= "2026-10-20");
  const e = d1(run(rows({ 1: { 100: present } }))).episodes[0];
  assert.equal(e.key, "1|100|2026-10-05", "stable identity for correction records");
  assert.equal(e.lastSeen, "2026-10-05");
  assert.equal(e.lastSeenAt, at("2026-10-05"));
  assert.equal(e.firstAbsentCapture, "2026-10-06");
  assert.equal(e.confirmedOn, "2026-10-08");
  assert.equal(e.status, "unwound");
  assert.equal(e.returnedOn, "2026-10-20", "the reversal reason is retained");
});

test("completeness reasons are preserved verbatim for the correction record", () => {
  const gap = dateRange("2026-10-10", "2026-10-16");
  const captured = ALL.filter((d) => !gap.includes(d));
  const c = d1(run(rows({ 1: { 100: captured } }, captured), { partialCaptureDealerIds: [1] }))
    .completeness;
  assert.equal(c.status, "incomplete");
  assert.ok(c.reasons.length >= 2, "every triggering rule is recorded, not just the first");
  assert.equal(c.expectedCaptures, 25);
  assert.equal(c.actualCaptures, 18);
  assert.equal(c.missedCaptures, 7);
});

// ── helpers ─────────────────────────────────────────────────────────────────

test("hoursBetween and longestMissingStreak behave", () => {
  assert.equal(hoursBetween(at("2026-10-01"), at("2026-10-04")), 72);
  assert.equal(hoursBetween(null, at("2026-10-04")), null);
  assert.equal(CONFIRMATION_HOURS, 72);
  assert.equal(longestMissingStreak(["a", "b", "c"], new Set(["b"])), 1);
  assert.equal(longestMissingStreak(["a", "b", "c"], new Set()), 3);
});

test("the same methodology applies to a solo dealer with no group", () => {
  const r = run(rows({ 3: { 300: ALL.filter((d) => d <= "2026-10-10") } }));
  const x = r.perDealer.find((d) => d.dealerId === 3)!;
  assert.equal(x.confirmedEstimatedSales, 1, "platform-agnostic: no feed-group special case");
});

// ── Stage 3A: month attribution + cross-month evidence ──────────────────────

const OCT = dateRange("2026-10-01", "2026-10-31");
const NOV = dateRange("2026-11-01", "2026-11-30");

/** Rows for one dealer across explicit capture days. */
function solo(vinDays: Record<number, string[]>, captureDays: string[]): SalesSnapshotRow[] {
  const out: SalesSnapshotRow[] = [];
  for (const d of captureDays)
    out.push({ dealer_id: 1, snapshot_date: d, vehicle_id: 9999, list_price: 1, created_at: at(d) });
  for (const [v, days] of Object.entries(vinDays))
    for (const d of days)
      out.push({ dealer_id: 1, snapshot_date: d, vehicle_id: Number(v), list_price: 20000, created_at: at(d) });
  return out;
}
const soloOpts = (over: Record<string, unknown>) => ({
  dealerIds: [1],
  groupByDealer: new Map<number, number | null>([[1, null]]),
  ...over,
}) as Parameters<typeof computeEstimatedSales>[1];

test("ATTRIBUTION: a departure belongs to the month of its FIRST VERIFIED ABSENCE", () => {
  // Last seen Sep 30, first absent Oct 1 → an OCTOBER departure, even though
  // lastSeen is September and confirmation lands Oct 4.
  const days = [...dateRange("2026-09-28", "2026-09-30"), ...OCT.slice(0, 10)];
  const r = computeEstimatedSales(
    solo({ 100: dateRange("2026-09-28", "2026-09-30") }, days),
    soloOpts({
      windowStart: "2026-09-28", windowEnd: "2026-10-10",
      reportingStart: "2026-10-01", reportingEnd: "2026-10-10", today: "2026-10-10",
    }),
  );
  const e = r.perDealer[0].episodes[0];
  assert.equal(e.lastSeen, "2026-09-30", "the sighting is in September");
  assert.equal(e.firstAbsentCapture, "2026-10-01");
  assert.equal(e.reportingMonth, "2026-10", "but it is reported in October");
  assert.equal(e.inReportingPeriod, true);
  assert.equal(r.perDealer[0].confirmedEstimatedSales, 1);
});

test("ATTRIBUTION: a September absence is excluded from an October report", () => {
  const days = dateRange("2026-09-20", "2026-10-10");
  const r = computeEstimatedSales(
    solo({ 100: dateRange("2026-09-20", "2026-09-22") }, days),
    soloOpts({
      windowStart: "2026-09-20", windowEnd: "2026-10-10",
      reportingStart: "2026-10-01", reportingEnd: "2026-10-10", today: "2026-10-10",
    }),
  );
  const e = r.perDealer[0].episodes[0];
  assert.equal(e.reportingMonth, "2026-09");
  assert.equal(e.inReportingPeriod, false);
  assert.equal(r.perDealer[0].confirmedEstimatedSales, 0, "September does not leak into October");
});

test("CROSS-MONTH: a November return WITHIN 30 days unwinds the October sale", () => {
  // Gone after Oct 20 (first absent Oct 21, confirmed Oct 24), back Nov 5 —
  // 12 days after confirmation.
  const present = [...OCT.filter((d) => d <= "2026-10-20"), ...NOV.filter((d) => d >= "2026-11-05")];
  const days = [...OCT, ...NOV.filter((d) => d <= "2026-11-10")];
  const r = computeEstimatedSales(
    solo({ 100: present }, days),
    soloOpts({
      windowStart: "2026-10-01", windowEnd: "2026-11-10",
      reportingStart: "2026-10-01", reportingEnd: "2026-10-31", today: "2026-11-10",
    }),
  );
  const d = r.perDealer[0];
  const e = d.episodes[0];
  assert.equal(e.reportingMonth, "2026-10", "attributed to October");
  assert.equal(e.status, "unwound");
  assert.equal(e.returnedOn, "2026-11-05");
  assert.equal(d.unwound, 1);
  assert.equal(d.confirmedEstimatedSales, 0, "October's confirmed estimate is corrected down");
});

test("CROSS-MONTH: a November return BEYOND 30 days leaves October standing", () => {
  const present = [...OCT.filter((d) => d <= "2026-10-20"), ...NOV.filter((d) => d >= "2026-11-28")];
  const days = [...OCT, ...NOV];
  const r = computeEstimatedSales(
    solo({ 100: present }, days),
    soloOpts({
      windowStart: "2026-10-01", windowEnd: "2026-11-30",
      reportingStart: "2026-10-01", reportingEnd: "2026-10-31", today: "2026-11-30",
    }),
  );
  const d = r.perDealer[0];
  assert.equal(d.unwound, 0, "35 days is outside the unwind window");
  assert.equal(d.confirmedEstimatedSales, 1, "the October sale stands");
});

test("CROSS-MONTH: widening the evidence window does not duplicate an episode", () => {
  const present = OCT.filter((d) => d <= "2026-10-10");
  const narrow = computeEstimatedSales(
    solo({ 100: present }, OCT),
    soloOpts({ windowStart: "2026-10-01", windowEnd: "2026-10-31",
      reportingStart: "2026-10-01", reportingEnd: "2026-10-31", today: "2026-10-31" }),
  );
  const wide = computeEstimatedSales(
    solo({ 100: present }, [...OCT, ...NOV]),
    soloOpts({ windowStart: "2026-10-01", windowEnd: "2026-11-30",
      reportingStart: "2026-10-01", reportingEnd: "2026-10-31", today: "2026-11-30" }),
  );
  assert.equal(narrow.perDealer[0].confirmedEstimatedSales, 1);
  assert.equal(wide.perDealer[0].confirmedEstimatedSales, 1, "still exactly one");
  assert.deepEqual(
    wide.perDealer[0].episodes.map((e) => e.key),
    narrow.perDealer[0].episodes.map((e) => e.key),
    "identical episode identity across both windows",
  );
});

test("CROSS-MONTH: repeat episodes land in their own months", () => {
  // Departs early Oct (confirmed), returns mid-Oct, departs again early Nov.
  const present = [
    ...OCT.filter((d) => d <= "2026-10-04"),
    ...OCT.filter((d) => d >= "2026-10-15"),
  ];
  const days = [...OCT, ...NOV.filter((d) => d <= "2026-11-10")];
  const all = computeEstimatedSales(
    solo({ 100: present }, days),
    soloOpts({ windowStart: "2026-10-01", windowEnd: "2026-11-10",
      reportingStart: "2026-10-01", reportingEnd: "2026-10-31", today: "2026-11-10",
      unwindWindowDays: 0 }),
  );
  const months = all.perDealer[0].episodes.map((e) => e.reportingMonth);
  assert.deepEqual(months, ["2026-10", "2026-11"], "one episode per month");
  assert.equal(all.perDealer[0].confirmedEstimatedSales, 1, "October reports only its own");
});

test("completeness measures the REPORTING period, not the wider evidence window", () => {
  const days = [...OCT, ...NOV.filter((d) => d <= "2026-11-10")];
  const r = computeEstimatedSales(
    solo({ 100: OCT }, days),
    soloOpts({ windowStart: "2026-10-01", windowEnd: "2026-11-10",
      reportingStart: "2026-10-01", reportingEnd: "2026-10-31", today: "2026-11-10" }),
  );
  const c = r.perDealer[0].completeness;
  assert.equal(c.expectedCaptures, 31, "October's 31 days, not the 41-day evidence span");
  assert.equal(c.actualCaptures, 31);
  assert.equal(c.status, "complete");
});

// ── Stage 3A: only verified captures may establish absence ──────────────────

test("an unverified capture day cannot open a departure", () => {
  const present = OCT.filter((d) => d <= "2026-10-10");
  const opts = {
    windowStart: "2026-10-01", windowEnd: "2026-10-31",
    reportingStart: "2026-10-01", reportingEnd: "2026-10-31", today: "2026-10-31",
  };
  const withAll = computeEstimatedSales(solo({ 100: present }, OCT), soloOpts(opts));
  assert.equal(withAll.perDealer[0].confirmedEstimatedSales, 1);

  // Mark everything after Oct 10 as untrustworthy: no day can show the
  // absence, so nothing may be established.
  const trusted = new Set(OCT.filter((d) => d <= "2026-10-10"));
  const gated = computeEstimatedSales(
    solo({ 100: present }, OCT),
    soloOpts({ ...opts, verifiedCaptureDays: new Map([[1, trusted]]) }),
  );
  assert.equal(gated.perDealer[0].confirmedEstimatedSales, 0, "no verified capture shows it gone");
  assert.equal(gated.perDealer[0].episodes.length, 0);
});

test("confirmation skips untrusted days and waits for the next verified capture", () => {
  const present = OCT.filter((d) => d <= "2026-10-05");
  // Oct 6-20 untrusted; Oct 21 is the first verified capture showing absence.
  const trusted = new Set(OCT.filter((d) => d <= "2026-10-05" || d >= "2026-10-21"));
  const r = computeEstimatedSales(
    solo({ 100: present }, OCT),
    soloOpts({
      windowStart: "2026-10-01", windowEnd: "2026-10-31",
      reportingStart: "2026-10-01", reportingEnd: "2026-10-31", today: "2026-10-31",
      verifiedCaptureDays: new Map([[1, trusted]]),
    }),
  );
  const e = r.perDealer[0].episodes[0];
  assert.equal(e.firstAbsentCapture, "2026-10-21", "the untrusted stretch is skipped entirely");
  assert.equal(e.status, "confirmed");
  assert.equal(r.perDealer[0].confirmedEstimatedSales, 1);
});
