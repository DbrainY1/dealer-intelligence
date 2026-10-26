// Loader for the universal Estimated Sales engine.
//
// Assembles everything the pure engine needs and nothing it does not:
//   * snapshots over the EVIDENCE window (wider than the reported month)
//   * capture evidence from scrape_log / coverage_report / dealer_failure_state
//
// Read-only. No writes, no canonical lifecycle involvement.

import { fetchAllRowsCounted, fetchAllRows } from "./fetch-all.ts";
import { pacificDateStr } from "./dates.ts";
import { shiftDate } from "./dealer-freshness.ts";
import type { SupabaseLike } from "./dealer-freshness.ts";
import {
  assessDealerCaptures,
  verifiedCaptureDays,
  type CaptureAssessment,
  type CaptureEvidence,
  type ScrapeRun,
} from "./capture-verification.ts";
import {
  computeEstimatedSales,
  dateRangeInclusive,
  UNWIND_WINDOW_DAYS,
  type EstimatedSalesReport,
  type SalesSnapshotRow,
} from "./estimated-sales.ts";

export interface LoadOptions {
  dealerIds: number[];
  /** First day of the month being reported. */
  reportingStart: string;
  /** Last day of the month being reported (or today, mid-month). */
  reportingEnd: string;
  now?: Date;
  /** Operator-maintained: providers that changed without verified coverage. */
  unverifiedProviderDealerIds?: number[];
  /** Skip capture verification — used to reproduce the Stage 2 baseline. */
  skipVerification?: boolean;
  /** Days of history read before the reporting month. Defaults to LOOKBACK_DAYS. */
  lookbackDays?: number;
}

export interface EstimatedSalesLoad {
  report: EstimatedSalesReport;
  /** Per-dealer capture verdicts, for explaining what evidence was rejected. */
  captureAssessments: Map<number, CaptureAssessment[]>;
}

/**
 * Evidence must run past the reporting month by the unwind window so a return
 * in the following month can reverse the original month's confirmed estimate.
 * It never runs past today — there is no evidence from the future.
 */
export function evidenceWindowFor(
  reportingEnd: string,
  today: string,
  unwindDays: number = UNWIND_WINDOW_DAYS,
): string {
  const extended = shiftDate(reportingEnd, unwindDays);
  return extended < today ? extended : today;
}

/**
 * Days of history read BEFORE the reporting month.
 *
 * A vehicle last seen on the 29th of the prior month has its first verified
 * absence on the 1st, so it belongs to this month — but recognising that needs
 * the prior sighting in view. Without lookback the episode is invisible and
 * the month silently under-reports. The window is the confirmation interval
 * plus slack for a capture gap spanning the boundary.
 */
export const LOOKBACK_DAYS = 10;

export function evidenceStartFor(
  reportingStart: string,
  lookbackDays: number = LOOKBACK_DAYS,
): string {
  return shiftDate(reportingStart, -lookbackDays);
}

export async function loadEstimatedSales(
  supabase: SupabaseLike,
  opts: LoadOptions,
): Promise<EstimatedSalesLoad> {
  const today = pacificDateStr(opts.now ?? new Date());
  const windowStart = evidenceStartFor(opts.reportingStart, opts.lookbackDays);
  const windowEnd = evidenceWindowFor(opts.reportingEnd, today);
  const ids = opts.dealerIds;

  const [snapshots, dealerRows, scrapeRows, coverageRows, failureRows] = await Promise.all([
    fetchAllRowsCounted<SalesSnapshotRow>(
      "estimated sales snapshots",
      () =>
        supabase
          .from("inventory_snapshots")
          .select("dealer_id", { count: "exact", head: true })
          .in("dealer_id", ids)
          .gte("snapshot_date", windowStart)
          .lte("snapshot_date", windowEnd),
      (from, to) =>
        supabase
          .from("inventory_snapshots")
          .select("dealer_id, snapshot_date, vehicle_id, list_price, created_at")
          .in("dealer_id", ids)
          .gte("snapshot_date", windowStart)
          .lte("snapshot_date", windowEnd)
          .range(from, to),
    ),
    supabase.from("dealers").select("id, dealer_group_id").in("id", ids),
    opts.skipVerification
      ? Promise.resolve([])
      : fetchAllRows<{ dealer_id: number; run_at: string; status: string | null; vehicles_found: number | null }>(
          "scrape log",
          (from, to) =>
            supabase
              .from("scrape_log")
              .select("dealer_id, run_at, status, vehicles_found")
              .in("dealer_id", ids)
              .gte("run_at", windowStart)
              .lte("run_at", `${windowEnd}T23:59:59`)
              .range(from, to),
        ),
    opts.skipVerification
      ? Promise.resolve([])
      : fetchAllRows<{ dealer_id: number; checked_date: string; total_snapshots: number | null }>(
          "coverage report",
          (from, to) =>
            supabase
              .from("coverage_report")
              .select("dealer_id, checked_date, total_snapshots")
              .in("dealer_id", ids)
              .gte("checked_date", windowStart)
              .lte("checked_date", windowEnd)
              .range(from, to),
        ),
    opts.skipVerification
      ? Promise.resolve({ data: [] })
      : supabase
          .from("dealer_failure_state")
          .select("dealer_id, failure_class, recommended_action")
          .in("dealer_id", ids),
  ]);

  const groupByDealer = new Map<number, number | string | null>(
    ((dealerRows as { data?: { id: number; dealer_group_id: number | null }[] }).data ?? []).map(
      (d) => [d.id, d.dealer_group_id],
    ),
  );

  // FAIL CLOSED. `verified` stays undefined only when verification is
  // explicitly skipped (baseline reproduction). On the normal path it is
  // always populated, so a dealer whose evidence could not be assembled ends
  // up with an EMPTY trusted-day set and therefore publishes nothing — rather
  // than silently reverting to "every day holding rows is trustworthy".
  let verified: Map<number, Set<string>> | undefined;
  const captureAssessments = new Map<number, CaptureAssessment[]>();

  if (!opts.skipVerification) {
    // Snapshot volume per dealer-day.
    const volume = new Map<string, number>();
    for (const r of snapshots) {
      const k = `${r.dealer_id}|${r.snapshot_date}`;
      volume.set(k, (volume.get(k) ?? 0) + 1);
    }
    // Every run of a dealer-day, keyed by the run's calendar date.
    const runs = new Map<string, ScrapeRun[]>();
    for (const r of scrapeRows as { dealer_id: number; run_at: string; status: string | null; vehicles_found: number | null }[]) {
      const k = `${r.dealer_id}|${r.run_at.slice(0, 10)}`;
      const list = runs.get(k) ?? [];
      list.push({ status: r.status, vehiclesFound: r.vehicles_found });
      runs.set(k, list);
    }
    const coverage = new Map<string, number | null>();
    for (const r of coverageRows as { dealer_id: number; checked_date: string; total_snapshots: number | null }[]) {
      coverage.set(`${r.dealer_id}|${r.checked_date}`, r.total_snapshots);
    }
    const failure = new Map<number, { failure_class: string | null; recommended_action: string | null }>();
    for (const r of ((failureRows as { data?: { dealer_id: number; failure_class: string | null; recommended_action: string | null }[] }).data ?? [])) {
      failure.set(r.dealer_id, r);
    }

    const days = dateRangeInclusive(windowStart, windowEnd);
    for (const dealerId of ids) {
      const evidence: CaptureEvidence[] = days.map((date) => ({
        dealerId,
        date,
        snapshotRows: volume.get(`${dealerId}|${date}`) ?? 0,
        runs: runs.get(`${dealerId}|${date}`) ?? [],
        coverageTotal: coverage.get(`${dealerId}|${date}`) ?? null,
        failureClass: failure.get(dealerId)?.failure_class ?? null,
        recommendedAction: failure.get(dealerId)?.recommended_action ?? null,
      }));
      captureAssessments.set(dealerId, assessDealerCaptures(evidence));
    }
    verified = verifiedCaptureDays(captureAssessments);
    // Any dealer missing from the map gets an explicit empty set: unknown
    // evidence is treated as no evidence, never as implicit trust.
    for (const id of ids) if (!verified.has(id)) verified.set(id, new Set());
  }

  const report = computeEstimatedSales(snapshots, {
    dealerIds: ids,
    groupByDealer,
    windowStart,
    windowEnd,
    reportingStart: opts.reportingStart,
    reportingEnd: opts.reportingEnd,
    today,
    verifiedCaptureDays: verified,
    unverifiedProviderDealerIds: opts.unverifiedProviderDealerIds,
  });

  return { report, captureAssessments };
}
