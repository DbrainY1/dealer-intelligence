// Verified-complete capture detection.

import { test } from "node:test";
import assert from "node:assert/strict";
import {
  assessCaptureDay,
  assessDealerCaptures,
  verifiedCaptureDays,
  bestRun,
  median,
  countTolerance,
  PARTIAL_VOLUME_RATIO,
  type CaptureEvidence,
} from "./capture-verification.ts";

const ev = (over: Partial<CaptureEvidence> = {}): CaptureEvidence => ({
  dealerId: 1,
  date: "2026-10-10",
  snapshotRows: 100,
  runs: [{ status: "success", vehiclesFound: 100 }],
  coverageTotal: null,
  failureClass: null,
  recommendedAction: null,
  ...over,
});

// ── corroboration ───────────────────────────────────────────────────────────

test("a successful run matching the row count verifies the capture", () => {
  const a = assessCaptureDay(ev(), null);
  assert.equal(a.verdict, "verified");
  assert.equal(a.establishesAbsence, true);
  assert.equal(a.corroboratedBy, "scrape_log");
});

test("an off-by-one disagreement is inside tolerance", () => {
  // Observed once in October: dealer 31 on 10-21, snap 105 vs reported 106.
  const a = assessCaptureDay(ev({ snapshotRows: 105, runs: [{ status: "success", vehiclesFound: 106 }] }), null);
  assert.equal(a.verdict, "verified");
  assert.equal(countTolerance(105), 3, "2% of 105, rounded up");
});

test("a large disagreement is UNCORROBORATED and cannot establish absence", () => {
  const a = assessCaptureDay(ev({ snapshotRows: 20, runs: [{ status: "success", vehiclesFound: 200 }] }), null);
  assert.equal(a.verdict, "uncorroborated");
  assert.equal(a.establishesAbsence, false);
  assert.match(a.reasons[0], /reported 200 vehicles but 20 rows/);
});

test("feed dealers verify via coverage_report, having no scrape_log rows", () => {
  const a = assessCaptureDay(ev({ runs: [], coverageTotal: 100 }), null);
  assert.equal(a.verdict, "verified");
  assert.equal(a.corroboratedBy, "coverage_report");
});

test("rows with no corroborating source at all are UNCORROBORATED", () => {
  const a = assessCaptureDay(ev({ runs: [], coverageTotal: null }), null);
  assert.equal(a.verdict, "uncorroborated");
  assert.equal(a.establishesAbsence, false);
});

// ── multiple runs per dealer-day ────────────────────────────────────────────

test("the best successful run wins when a day has several attempts", () => {
  // Real shape: dealer 5 on 10-25 logged success 200 then two errors.
  const runs = [
    { status: "success", vehiclesFound: 200 },
    { status: "error", vehiclesFound: 0 },
    { status: "error", vehiclesFound: 0 },
  ];
  assert.equal(bestRun(runs)?.vehiclesFound, 200);
  const a = assessCaptureDay(ev({ snapshotRows: 200, runs }), null);
  assert.equal(a.verdict, "verified", "later failures do not invalidate a good capture");
});

test("an error run reporting zero is NEVER read as an empty dealership", () => {
  const a = assessCaptureDay(
    ev({ snapshotRows: 0, runs: [{ status: "error", vehiclesFound: 0 }] }),
    null,
  );
  assert.equal(a.verdict, "failed");
  assert.equal(a.establishesAbsence, false, "a failed run cannot establish any VIN absence");
  assert.equal(a.snapshotRows, 0);
});

test("drift_detected is treated as unverified, not as absence", () => {
  const a = assessCaptureDay(
    ev({ snapshotRows: 0, runs: [{ status: "drift_detected", vehiclesFound: 0 }] }),
    null,
  );
  assert.equal(a.verdict, "failed");
  assert.equal(a.establishesAbsence, false);
});

test("a day with no rows and no runs is simply no_capture", () => {
  const a = assessCaptureDay(ev({ snapshotRows: 0, runs: [] }), null);
  assert.equal(a.verdict, "no_capture");
  assert.equal(a.establishesAbsence, false);
});

// ── structural failure ──────────────────────────────────────────────────────

test("structural failure rejects an uncorroborated capture, not a corroborated one", () => {
  // Uncorroborated + failing → rejected.
  const bare = { runs: [], coverageTotal: null };
  assert.equal(assessCaptureDay(ev({ ...bare, failureClass: "structural" }), null).verdict, "failed");
  assert.equal(
    assessCaptureDay(ev({ ...bare, recommendedAction: "manual_repair" }), null).verdict,
    "failed",
  );

  // Corroborated + failing → still verified. Current failure state cannot
  // overturn a capture an independent source confirms.
  assert.equal(assessCaptureDay(ev({ failureClass: "structural" }), null).verdict, "verified");
});

// ── volume anomaly: indicator, not proof ────────────────────────────────────

test("volume far below the trailing median is SUSPECTED partial, handled conservatively", () => {
  const a = assessCaptureDay(ev({ snapshotRows: 20, runs: [{ status: "success", vehiclesFound: 20 }] }), 100);
  assert.equal(a.verdict, "suspected_partial", "suspected — not asserted as partial");
  assert.equal(a.establishesAbsence, false, "conservative: it cannot establish absence");
  assert.match(a.reasons[0], /suspected partial capture/);
  assert.equal(a.corroboratedBy, "scrape_log", "it was still corroborated; only the volume is odd");
});

test("volume just above the ratio stays verified", () => {
  const n = Math.ceil(100 * PARTIAL_VOLUME_RATIO) + 1;
  const a = assessCaptureDay(ev({ snapshotRows: n, runs: [{ status: "success", vehiclesFound: n }] }), 100);
  assert.equal(a.verdict, "verified");
});

test("with no trailing history the volume check cannot fire", () => {
  const a = assessCaptureDay(ev({ snapshotRows: 2, runs: [{ status: "success", vehiclesFound: 2 }] }), null);
  assert.equal(a.verdict, "verified", "a first capture is not suspected on volume alone");
});

// ── trailing median construction ────────────────────────────────────────────

test("the trailing median is built only from already-verified days", () => {
  // A long slide of degraded captures must not re-baseline itself into
  // acceptance. Day 1 sets the baseline at 100; the collapse stays suspect.
  const days = ["2026-10-01", "2026-10-02", "2026-10-03", "2026-10-04"];
  const vols = [100, 10, 10, 10];
  const out = assessDealerCaptures(
    days.map((date, i) => ev({ date, snapshotRows: vols[i], runs: [{ status: "success", vehiclesFound: vols[i] }] })),
  );
  assert.equal(out[0].verdict, "verified");
  assert.deepEqual(
    out.slice(1).map((a) => a.verdict),
    ["suspected_partial", "suspected_partial", "suspected_partial"],
    "the degraded run never becomes the new normal",
  );
});

test("verifiedCaptureDays yields only days that may establish absence", () => {
  const list = assessDealerCaptures([
    ev({ date: "2026-10-01" }),
    ev({ date: "2026-10-02", snapshotRows: 0, runs: [{ status: "error", vehiclesFound: 0 }] }),
    ev({ date: "2026-10-03" }),
  ]);
  const days = verifiedCaptureDays(new Map([[1, list]]));
  assert.deepEqual([...days.get(1)!].sort(), ["2026-10-01", "2026-10-03"]);
});

test("median helper", () => {
  assert.equal(median([]), null);
  assert.equal(median([5]), 5);
  assert.equal(median([1, 3]), 2);
  assert.equal(median([3, 1, 2]), 2);
});

// ── REGRESSION: failure state must not reach backwards ──────────────────────

test("REGRESSION: a current structural failure does not invalidate a corroborated capture", () => {
  // Dealer 5, October: ~200 rows daily, each matched exactly by scrape_log.
  // A parse_failure was recorded on Oct 25. Rejecting the whole month because
  // of it discarded 38 real departures.
  const a = assessCaptureDay(
    ev({
      date: "2026-10-02",
      snapshotRows: 197,
      runs: [{ status: "success", vehiclesFound: 197 }],
      failureClass: "structural",
      recommendedAction: "manual_repair",
    }),
    198,
  );
  assert.equal(a.verdict, "verified", "independent corroboration outranks current failure state");
  assert.equal(a.establishesAbsence, true);
  assert.equal(a.corroboratedBy, "scrape_log");
});

test("REGRESSION: a structural failure DOES reject an uncorroborated capture", () => {
  const a = assessCaptureDay(
    ev({ snapshotRows: 50, runs: [], coverageTotal: null, failureClass: "structural" }),
    null,
  );
  assert.equal(a.verdict, "failed");
  assert.equal(a.establishesAbsence, false);
  assert.match(a.reasons[0], /uncorroborated/);
});

test("REGRESSION: failure state is never used to date when a failure began", () => {
  // Same evidence, two dates far apart — the verdict must not differ, because
  // dealer_failure_state.updated_at records when the ROW was written, not
  // when the failure started.
  const mk = (date: string) =>
    assessCaptureDay(
      ev({ date, snapshotRows: 10, runs: [], coverageTotal: null, failureClass: "structural" }),
      null,
    ).verdict;
  assert.equal(mk("2026-01-01"), mk("2026-10-25"), "no date-based scoping of the failure gate");
});

// ── REGRESSION: stable volume is not completeness ───────────────────────────

test("REGRESSION: a sustained low volume stays SUSPECTED, never auto-verified", () => {
  // Dealer 32: ~93 on Oct 1-3, then ten consecutive corroborated days at
  // 44-49. The level is stable, but stability is not evidence of
  // completeness — a scraper can miss the same vehicles every run. These
  // captures must stay flagged until independent completeness evidence
  // supports the new baseline.
  const early = ["2026-10-01", "2026-10-02", "2026-10-03"].map((date, i) =>
    ev({ date, snapshotRows: [98, 93, 91][i], runs: [{ status: "success", vehiclesFound: [98, 93, 91][i] }] }),
  );
  const late = ["2026-10-16", "2026-10-17", "2026-10-18", "2026-10-19", "2026-10-20"].map((date, i) => {
    const n = [47, 49, 49, 49, 45][i];
    return ev({ date, snapshotRows: n, runs: [{ status: "success", vehiclesFound: n }] });
  });

  const out = assessDealerCaptures([...early, ...late]);
  assert.deepEqual(out.slice(0, 3).map((a) => a.verdict), ["verified", "verified", "verified"]);
  assert.deepEqual(
    out.slice(3).map((a) => a.verdict),
    Array(5).fill("suspected_partial"),
    "every sustained low day stays suspected — no automatic re-baseline",
  );
  for (const a of out.slice(3)) {
    assert.equal(a.establishesAbsence, false, "and none may establish a VIN absence");
    assert.equal(a.corroboratedBy, "scrape_log", "even though the count itself is corroborated");
  }
});

test("REGRESSION: the trailing median never absorbs suspected days", () => {
  const days = ["2026-10-01", "2026-10-02", "2026-10-03", "2026-10-04", "2026-10-05"];
  const vols = [100, 20, 20, 20, 20];
  const out = assessDealerCaptures(
    days.map((date, i) =>
      ev({ date, snapshotRows: vols[i], runs: [{ status: "success", vehiclesFound: vols[i] }] }),
    ),
  );
  assert.equal(out[0].verdict, "verified");
  for (const a of out.slice(1)) {
    assert.equal(a.verdict, "suspected_partial");
    assert.equal(a.trailingMedian, 100, "the baseline stays at the last verified level");
  }
});
