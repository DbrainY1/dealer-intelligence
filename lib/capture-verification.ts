// Verified-complete capture detection.
//
// The estimator may only open or confirm a VIN absence on a capture it trusts.
// "The scraper exited successfully" is NOT that proof: a run can report
// success and write nothing, and an `error` run reporting zero vehicles is a
// failed capture, never an empty dealership.
//
// Evidence comes entirely from tables DBRAIN already writes — no new schema:
//
//   inventory_snapshots     the capture itself (row count per dealer-day)
//   scrape_log              per-RUN status + vehicles_found (scraper dealers)
//   coverage_report         per-day total_snapshots (feed dealers have no
//                           scrape_log rows at all, so this is their only
//                           corroboration)
//   dealer_failure_state    structural failure suppresses verification
//
// Measured over October (123 dealer-days): 84 corroborated by a successful
// scrape_log run — 83 exact, one off by a single vehicle — and 39 by
// coverage_report. Zero dealer-days had no corroboration available. The
// tolerance below is sized from that, not guessed.

/** Count tolerance: at least 1 vehicle, or 2% of the snapshot count. */
export function countTolerance(snapshotRows: number): number {
  return Math.max(1, Math.ceil(snapshotRows * 0.02));
}

/**
 * Snapshot volume below this share of the dealer's trailing median is an
 * ANOMALY INDICATOR, not proof of a partial capture. It is treated
 * conservatively — the day cannot establish a new absence — but it is
 * reported as "suspected", never asserted as fact.
 */
export const PARTIAL_VOLUME_RATIO = 0.6;

/** Captures considered when computing the trailing median. */
export const TRAILING_WINDOW = 14;

export type CaptureVerdict =
  | "verified"           // trustworthy: may establish and confirm absence
  | "suspected_partial"  // volume anomaly — conservative, cannot establish
  | "uncorroborated"     // rows exist but no source agrees
  | "failed"             // run errored / drifted / structurally broken
  | "no_capture";        // nothing was written at all

export interface ScrapeRun {
  status: string | null;
  vehiclesFound: number | null;
}

export interface CaptureEvidence {
  dealerId: number;
  date: string;
  /** Rows actually present in inventory_snapshots for this dealer-day. */
  snapshotRows: number;
  /** EVERY scrape_log run for the dealer-day. Multiple runs are normal. */
  runs: ScrapeRun[];
  /** coverage_report.total_snapshots, when a check ran. */
  coverageTotal: number | null;
  /**
   * dealer_failure_state — CURRENT state for the dealer. It carries no
   * per-day history, and its updated_at records when the row was last
   * written, NOT when the failure began. It therefore cannot date a failure
   * and must never retroactively invalidate an older capture that an
   * independent source corroborates.
   */
  failureClass: string | null;
  recommendedAction: string | null;
}

export interface CaptureAssessment {
  dealerId: number;
  date: string;
  verdict: CaptureVerdict;
  /** Only a `verified` capture may establish or confirm a VIN absence. */
  establishesAbsence: boolean;
  reasons: string[];
  snapshotRows: number;
  corroboratedBy: "scrape_log" | "coverage_report" | null;
  corroboratedCount: number | null;
  trailingMedian: number | null;
}

/** Median of a numeric list; null when empty. */
export function median(values: number[]): number | null {
  if (values.length === 0) return null;
  const s = [...values].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 === 0 ? (s[mid - 1] + s[mid]) / 2 : s[mid];
}

/**
 * Best run of a dealer-day.
 *
 * A dealer is commonly scraped several times a day and the attempts disagree —
 * one success alongside two errors is routine. The successful run with the
 * highest vehicle count is the one that produced the capture; error and
 * drift runs reporting zero are failures, not evidence of an empty lot.
 */
export function bestRun(runs: ScrapeRun[]): ScrapeRun | null {
  const ok = runs.filter((r) => r.status === "success" && r.vehiclesFound != null);
  if (ok.length === 0) return null;
  return ok.reduce((a, b) => ((b.vehiclesFound ?? 0) > (a.vehiclesFound ?? 0) ? b : a));
}

/** True when any run reported a non-success outcome. */
export function hasFailedRun(runs: ScrapeRun[]): boolean {
  return runs.some((r) => r.status != null && r.status !== "success");
}

/**
 * Assess a single dealer-day.
 *
 * `trailingMedian` is the dealer's median snapshot volume over its recent
 * verified captures, supplied by the caller so this stays pure.
 */
export function assessCaptureDay(
  e: CaptureEvidence,
  trailingMedian: number | null,
): CaptureAssessment {
  const reasons: string[] = [];
  const base = {
    dealerId: e.dealerId,
    date: e.date,
    snapshotRows: e.snapshotRows,
    trailingMedian,
    corroboratedBy: null as "scrape_log" | "coverage_report" | null,
    corroboratedCount: null as number | null,
  };

  // Nothing was written. Silence, not absence.
  if (e.snapshotRows === 0) {
    if (hasFailedRun(e.runs)) {
      const statuses = [...new Set(e.runs.map((r) => r.status))].join(", ");
      reasons.push(`no rows written; run status ${statuses}`);
      return { ...base, verdict: "failed", establishesAbsence: false, reasons };
    }
    reasons.push("no capture for this day");
    return { ...base, verdict: "no_capture", establishesAbsence: false, reasons };
  }

  // Corroboration is evaluated FIRST. A capture that scrape_log or
  // coverage_report independently confirms is a real capture, whatever the
  // dealer's current failure state says. Scraper dealers via scrape_log; feed dealers have no
  // scrape_log rows, so coverage_report is their only source.
  const run = bestRun(e.runs);
  const tol = countTolerance(e.snapshotRows);
  let corroboratedBy: "scrape_log" | "coverage_report" | null = null;
  let corroboratedCount: number | null = null;

  if (run && run.vehiclesFound != null && Math.abs(run.vehiclesFound - e.snapshotRows) <= tol) {
    corroboratedBy = "scrape_log";
    corroboratedCount = run.vehiclesFound;
  } else if (
    e.coverageTotal != null &&
    Math.abs(e.coverageTotal - e.snapshotRows) <= tol
  ) {
    corroboratedBy = "coverage_report";
    corroboratedCount = e.coverageTotal;
  }

  // Structural failure downgrades only captures nothing else can vouch for.
  // We cannot date when the failure began, so it is never used to overturn
  // corroborated history.
  const failing = e.failureClass === "structural" || e.recommendedAction === "manual_repair";
  if (failing && !corroboratedBy) {
    reasons.push(
      `dealer in structural failure (${e.failureClass ?? e.recommendedAction}) ` +
        `and the capture is uncorroborated`,
    );
    return { ...base, verdict: "failed", establishesAbsence: false, reasons };
  }

  if (!corroboratedBy) {
    if (run && run.vehiclesFound != null) {
      reasons.push(
        `scrape_log reported ${run.vehiclesFound} vehicles but ${e.snapshotRows} rows were written (tolerance ±${tol})`,
      );
    } else if (e.coverageTotal != null) {
      reasons.push(
        `coverage_report reported ${e.coverageTotal} but ${e.snapshotRows} rows were written (tolerance ±${tol})`,
      );
    } else {
      reasons.push("no corroborating run or coverage record");
    }
    return {
      ...base,
      verdict: "uncorroborated",
      establishesAbsence: false,
      reasons,
      corroboratedBy,
      corroboratedCount,
    };
  }

  // Volume anomaly. An indicator, deliberately not treated as proof.
  if (trailingMedian != null && trailingMedian > 0) {
    const floor = trailingMedian * PARTIAL_VOLUME_RATIO;
    if (e.snapshotRows < floor) {
      reasons.push(
        `volume ${e.snapshotRows} is below ${Math.round(PARTIAL_VOLUME_RATIO * 100)}% of the ` +
          `trailing median ${trailingMedian} — suspected partial capture`,
      );
      return {
        ...base,
        verdict: "suspected_partial",
        establishesAbsence: false,
        reasons,
        corroboratedBy,
        corroboratedCount,
      };
    }
  }

  return {
    ...base,
    verdict: "verified",
    establishesAbsence: true,
    reasons,
    corroboratedBy,
    corroboratedCount,
  };
}

/**
 * Assess every day for one dealer, oldest first.
 *
 * The trailing median is built only from days already judged `verified`, so a
 * run of degraded captures cannot drag the baseline down and quietly start
 * accepting itself.
 */
export function assessDealerCaptures(evidence: CaptureEvidence[]): CaptureAssessment[] {
  const ordered = [...evidence].sort((a, b) => a.date.localeCompare(b.date));
  const verifiedVolumes: number[] = [];
  const out: CaptureAssessment[] = [];

  for (const e of ordered) {
    const trailing = median(verifiedVolumes.slice(-TRAILING_WINDOW));
    const a = assessCaptureDay(e, trailing);
    out.push(a);
    if (a.verdict === "verified") verifiedVolumes.push(e.snapshotRows);
  }
  return out;
}

/** Dates whose captures may establish or confirm an absence, per dealer. */
export function verifiedCaptureDays(
  assessments: Map<number, CaptureAssessment[]>,
): Map<number, Set<string>> {
  const out = new Map<number, Set<string>>();
  for (const [dealerId, list] of assessments) {
    out.set(dealerId, new Set(list.filter((a) => a.establishesAbsence).map((a) => a.date)));
  }
  return out;
}
