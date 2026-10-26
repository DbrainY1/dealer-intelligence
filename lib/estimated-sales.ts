// Universal VIN-based Estimated Sales (Stage 2).
//
// One methodology for every inventory platform. VIN disappearance is the only
// primary trigger — a dealer's own SOLD label never creates a sale here.
//
// SHADOW ONLY. Nothing in this module is wired into a production surface yet.
// It writes nothing, reclassifies nothing, and leaves canonical `sold` events
// and `monthly_sales` entirely alone. The existing per-feed estimator in
// lib/estimated-departures.ts continues to drive what DealerIQ renders today;
// this engine exists to be compared against it before any cutover.
//
// ── Why this is not just an edit to the existing estimator ─────────────────
// The shipped estimator keeps a single `lastSeen` per VIN, so it can only ever
// recognise one departure per vehicle. The agreed methodology requires each
// independently qualifying departure to count, which needs a per-episode model.
// Changing the shipped estimator in place would move live figures before the
// shadow comparison has been reviewed, so the episode engine lands beside it.
// It reuses the shipped date helpers rather than re-deriving them.
//
// ── Lifecycle of a departure episode ──────────────────────────────────────
//   present → absent on the next VERIFIED capture        → pending
//   still absent on a verified capture ≥72h after last   → confirmed
//   returns to the same dealer before that confirmation  → voided (no sale)
//   returns within 30 days of confirmation               → unwound (reversed)
//   appears at a sibling dealer in the same group        → transfer (no sale)
//
// Failed, partial or unverified captures can neither open nor confirm an
// episode: a day with no capture is silence, not evidence of absence.

import { dateRange } from "./estimated-departures.ts";

/** Re-exported so loaders need only one import for window maths. */
export function dateRangeInclusive(start: string, end: string): string[] {
  return dateRange(start, end);
}
import { shiftDate } from "./dealer-freshness.ts";

/** 72 hours, expressed in hours, measured against real capture timestamps. */
export const CONFIRMATION_HOURS = 72;

/**
 * Date-boundary threshold for the fallback path, used ONLY when a capture
 * carries no usable timestamp.
 *
 * Without timestamps the true elapsed interval is unknown: two captures dated
 * a day apart could be 1 hour or 47 hours apart. Counting whole dates as 24
 * hours each would therefore confirm departures that may not have reached 72
 * real hours. The fallback instead requires at least four date boundaries
 * between the FIRST VERIFIED ABSENCE and the confirming capture, which
 * guarantees the real interval exceeds 72 hours regardless of capture times.
 *
 *   first absence Jan 1 → capture Jan 5 (4 boundaries) qualifies
 *   first absence Jan 1 → capture Jan 4 (3 boundaries) does NOT
 */
export const CONFIRMATION_DATE_BOUNDARIES = 4;

/** A return inside this window reverses an already-confirmed estimated sale. */
export const UNWIND_WINDOW_DAYS = 30;

/** Consecutive missed scheduled captures that force INCOMPLETE. */
export const MAX_CONSECUTIVE_MISSES = 5;

/** Missed-capture share above which a month is AT RISK / INCOMPLETE. */
export const MAX_MISSED_RATIO = 0.2;

export interface SalesSnapshotRow {
  dealer_id: number;
  snapshot_date: string;
  vehicle_id: number;
  list_price?: number | null;
  /** Real capture timestamp. Required for timestamp-accurate confirmation. */
  created_at?: string | null;
}

export type EpisodeStatus = "pending" | "confirmed" | "voided" | "unwound" | "transfer";

export interface DepartureEpisode {
  dealerId: number;
  vehicleId: number;
  /** Last captured day the vehicle was present. */
  lastSeen: string;
  /** Capture timestamp of that sighting, when available. */
  lastSeenAt: string | null;
  /** First verified capture showing it absent. Null when none has happened. */
  firstAbsentCapture: string | null;
  /** Capture that satisfied the 72-hour rule. */
  confirmedOn: string | null;
  confirmedAt: string | null;
  elapsedHoursAtConfirmation: number | null;
  /** Which rule confirmed it — real timestamps, or the date-boundary fallback. */
  confirmationBasis: "timestamp" | "date_boundary" | null;
  /** Date boundaries from first verified absence to the confirming capture. */
  dateBoundariesAtConfirmation: number | null;
  status: EpisodeStatus;
  /** Advertised price on the last sighting. Null when never advertised. */
  lastAdvertisedPrice: number | null;
  /** Day the vehicle came back, for voided / unwound episodes. */
  returnedOn: string | null;
  /** False when the departure straddles a capture gap and cannot be dated. */
  dated: boolean;
  /**
   * Month this departure is reported in: the month of its FIRST VERIFIED
   * ABSENCE. Not lastSeen (which can sit in the prior month) and not the
   * confirmation date (which can sit in the next one).
   */
  reportingMonth: string | null;
  /** False when the episode falls outside the reporting period. */
  inReportingPeriod: boolean;
  /** Stable identity, so one episode can never be counted twice. */
  key: string;
}

export type Completeness = "complete" | "at_risk" | "incomplete";

export interface CompletenessAssessment {
  status: Completeness;
  reasons: string[];
  expectedCaptures: number;
  actualCaptures: number;
  missedCaptures: number;
  missedRatio: number;
  longestMissStreak: number;
  monthEnded: boolean;
}

export interface DealerEstimatedSales {
  dealerId: number;
  completeness: CompletenessAssessment;
  confirmedEstimatedSales: number;
  pendingDepartures: number;
  /** Headline: confirmed + pending. An episode sits in exactly one bucket. */
  potentialSales: number;
  unwound: number;
  voided: number;
  excludedTransfers: number;
  /** Null when the month is INCOMPLETE — projections are suppressed. */
  projectedMonthlySales: number | null;
  /** Null when INCOMPLETE. Confirmed sales only, never pending. */
  sellThroughPct: number | null;
  inventoryOnLastCapture: number;
  advertised: {
    pricedCount: number;
    missingPriceCount: number;
    totalAdvertised: number;
    avgAdvertised: number | null;
  };
  episodes: DepartureEpisode[];
}

export interface EstimatedSalesOptions {
  dealerIds: number[];
  /** dealerId → ownership group. Movement inside a group is never a sale. */
  groupByDealer: Map<number, number | string | null>;
  /**
   * EVIDENCE window — the rows actually read.
   *
   * This must extend past the reporting period by at least the unwind window,
   * otherwise a November return can never reverse an October sale. Widening
   * it cannot create duplicate episodes: identity is the stable
   * `dealer|vin|lastSeen` key.
   */
  windowStart: string;
  windowEnd: string;
  /**
   * REPORTING period — what the figures describe. Defaults to the evidence
   * window. A departure belongs to the month of its FIRST VERIFIED ABSENCE,
   * so only episodes whose firstAbsentCapture falls in here are counted.
   */
  reportingStart?: string;
  reportingEnd?: string;
  /**
   * Capture days trusted to establish or confirm an absence, per dealer.
   * Supplied by lib/capture-verification. When omitted every day holding
   * rows is trusted, which is the pre-Stage-3A behaviour.
   */
  verifiedCaptureDays?: Map<number, Set<string>>;
  /** "Now" as a Pacific calendar date, for month-end detection. */
  today: string;
  /** Dealers with a verified partial capture — forces INCOMPLETE. */
  partialCaptureDealerIds?: number[];
  /** Dealers whose provider changed without verified coverage — INCOMPLETE. */
  unverifiedProviderDealerIds?: number[];
  confirmationHours?: number;
  /** Date boundaries required on the no-timestamp fallback path. */
  confirmationDateBoundaries?: number;
  unwindWindowDays?: number;
}

export interface EstimatedSalesReport {
  windowStart: string;
  windowEnd: string;
  reportingStart: string;
  reportingEnd: string;
  confirmationHours: number;
  perDealer: DealerEstimatedSales[];
  totals: {
    confirmedEstimatedSales: number;
    pendingDepartures: number;
    potentialSales: number;
    unwound: number;
    voided: number;
    excludedTransfers: number;
  };
  /** Dealers excluded from market comparison because their month is INCOMPLETE. */
  incompleteDealerIds: number[];
  atRiskDealerIds: number[];
}

/** Whole hours between two ISO timestamps; null when either is unknown. */
export function hoursBetween(a: string | null, b: string | null): number | null {
  if (!a || !b) return null;
  const ms = new Date(b).getTime() - new Date(a).getTime();
  if (Number.isNaN(ms)) return null;
  return ms / 3_600_000;
}

/** Longest run of consecutive missing days. */
export function longestMissingStreak(expected: string[], present: Set<string>): number {
  let best = 0;
  let run = 0;
  for (const d of expected) {
    if (present.has(d)) run = 0;
    else best = Math.max(best, ++run);
  }
  return best;
}

/**
 * Classify a dealer's capture coverage for the window.
 *
 * A month that is INCOMPLETE keeps its verified counts — only projections and
 * market comparison are withheld. Reasons are preserved verbatim so a later
 * correction record can cite why a month was held back.
 */
export function assessCompleteness(
  expected: string[],
  presentDays: Set<string>,
  opts: { monthEnded: boolean; partialCapture: boolean; unverifiedProvider: boolean },
): CompletenessAssessment {
  const actual = expected.filter((d) => presentDays.has(d)).length;
  const missed = expected.length - actual;
  const ratio = expected.length > 0 ? missed / expected.length : 0;
  const streak = longestMissingStreak(expected, presentDays);

  const reasons: string[] = [];
  let status: Completeness = "complete";

  if (streak >= MAX_CONSECUTIVE_MISSES) {
    status = "incomplete";
    reasons.push(`${streak} consecutive missed captures (limit ${MAX_CONSECUTIVE_MISSES})`);
  }
  if (ratio > MAX_MISSED_RATIO) {
    if (opts.monthEnded) {
      status = "incomplete";
      reasons.push(
        `${(ratio * 100).toFixed(0)}% of scheduled captures missing at month end (limit 20%)`,
      );
    } else {
      if (status !== "incomplete") status = "at_risk";
      reasons.push(`${(ratio * 100).toFixed(0)}% of scheduled captures missing so far (limit 20%)`);
    }
  }
  if (opts.partialCapture) {
    status = "incomplete";
    reasons.push("verified partial inventory capture");
  }
  if (opts.unverifiedProvider) {
    status = "incomplete";
    reasons.push("inventory provider or website changed without verified coverage");
  }

  return {
    status,
    reasons,
    expectedCaptures: expected.length,
    actualCaptures: actual,
    missedCaptures: missed,
    missedRatio: ratio,
    longestMissStreak: streak,
    monthEnded: opts.monthEnded,
  };
}

/**
 * Compute universal estimated sales for every dealer in `dealerIds`.
 *
 * Pure — the caller supplies the rows. Identical arithmetic regardless of
 * whether the inventory arrived from a scraper or a supplied feed.
 */
export function computeEstimatedSales(
  rows: SalesSnapshotRow[],
  opts: EstimatedSalesOptions,
): EstimatedSalesReport {
  const confirmationHours = opts.confirmationHours ?? CONFIRMATION_HOURS;
  const boundaryThreshold = opts.confirmationDateBoundaries ?? CONFIRMATION_DATE_BOUNDARIES;
  const unwindDays = opts.unwindWindowDays ?? UNWIND_WINDOW_DAYS;
  const reportingStart = opts.reportingStart ?? opts.windowStart;
  const reportingEnd = opts.reportingEnd ?? opts.windowEnd;
  // Completeness describes the REPORTING period, never the wider evidence
  // window — otherwise extending evidence into the next month would look like
  // a coverage gap.
  const expected = dateRange(reportingStart, reportingEnd);
  const partial = new Set(opts.partialCaptureDealerIds ?? []);
  const unverified = new Set(opts.unverifiedProviderDealerIds ?? []);

  // dealer → date → VINs, plus price and capture timestamp indexes.
  const byDealer = new Map<number, Map<string, Set<number>>>();
  const priceAt = new Map<string, number | null>(); // "dealer|vin|date"
  const captureAt = new Map<string, string>(); // "dealer|date" → latest created_at
  for (const id of opts.dealerIds) byDealer.set(id, new Map());

  for (const r of rows) {
    const dates = byDealer.get(r.dealer_id);
    if (!dates) continue;
    if (r.snapshot_date < opts.windowStart || r.snapshot_date > opts.windowEnd) continue;
    let set = dates.get(r.snapshot_date);
    if (!set) {
      set = new Set();
      dates.set(r.snapshot_date, set);
    }
    set.add(r.vehicle_id);
    if (r.list_price !== undefined) {
      priceAt.set(`${r.dealer_id}|${r.vehicle_id}|${r.snapshot_date}`, r.list_price);
    }
    if (r.created_at) {
      const k = `${r.dealer_id}|${r.snapshot_date}`;
      const prev = captureAt.get(k);
      if (!prev || r.created_at > prev) captureAt.set(k, r.created_at);
    }
  }

  // Group-wide presence, for transfer detection across ownership siblings.
  const groupPresence = new Map<string, Map<string, Set<number>>>(); // groupKey → date → VINs
  for (const id of opts.dealerIds) {
    const g = String(opts.groupByDealer.get(id) ?? `__solo_${id}`);
    let byDate = groupPresence.get(g);
    if (!byDate) {
      byDate = new Map();
      groupPresence.set(g, byDate);
    }
    for (const [date, vins] of byDealer.get(id)!) {
      let s = byDate.get(date);
      if (!s) {
        s = new Set();
        byDate.set(date, s);
      }
      for (const v of vins) s.add(v);
    }
  }

  // Month end = the window reaches the last day of its month AND today is past it.
  const monthEnded = (() => {
    const [y, m] = reportingEnd.split("-").map(Number);
    const lastOfMonth = new Date(Date.UTC(y, m, 0)).toISOString().slice(0, 10);
    return reportingEnd >= lastOfMonth && opts.today > lastOfMonth;
  })();

  const perDealer: DealerEstimatedSales[] = [];

  for (const dealerId of opts.dealerIds) {
    const dates = byDealer.get(dealerId)!;
    // A day only counts as evidence if it holds rows AND — when capture
    // verification is supplied — was judged trustworthy. An errored, drifted,
    // uncorroborated or suspected-partial capture can neither open nor
    // confirm an absence.
    const trusted = opts.verifiedCaptureDays?.get(dealerId) ?? null;
    const validDays = new Set(
      [...dates.keys()].filter(
        (d) => (dates.get(d)?.size ?? 0) > 0 && (trusted === null || trusted.has(d)),
      ),
    );
    const valid = [...validDays].sort();
    const groupKey = String(opts.groupByDealer.get(dealerId) ?? `__solo_${dealerId}`);
    const siblings = opts.dealerIds.filter(
      (id) => id !== dealerId && String(opts.groupByDealer.get(id) ?? `__solo_${id}`) === groupKey,
    );

    const completeness = assessCompleteness(expected, validDays, {
      monthEnded,
      partialCapture: partial.has(dealerId),
      unverifiedProvider: unverified.has(dealerId),
    });

    const result: DealerEstimatedSales = {
      dealerId,
      completeness,
      confirmedEstimatedSales: 0,
      pendingDepartures: 0,
      potentialSales: 0,
      unwound: 0,
      voided: 0,
      excludedTransfers: 0,
      projectedMonthlySales: null,
      sellThroughPct: null,
      inventoryOnLastCapture: 0,
      advertised: { pricedCount: 0, missingPriceCount: 0, totalAdvertised: 0, avgAdvertised: null },
      episodes: [],
    };

    if (valid.length === 0) {
      perDealer.push(result);
      continue;
    }

    const finalDay = valid[valid.length - 1];
    result.inventoryOnLastCapture = dates.get(finalDay)!.size;

    // Every VIN the dealer held at any point in the window.
    const allVins = new Set<number>();
    for (const d of valid) for (const v of dates.get(d)!) allVins.add(v);

    const seenKeys = new Set<string>();

    for (const vin of allVins) {
      // Presence across the dealer's VERIFIED capture days only.
      const presentOn = valid.filter((d) => dates.get(d)!.has(vin));
      if (presentOn.length === 0) continue;

      // One episode per present→absent transition. The final sighting opens an
      // episode too, unless the vehicle is still there on the last capture.
      for (let i = 0; i < presentOn.length; i++) {
        const last = presentOn[i];
        const idx = valid.indexOf(last);
        const nextCapture = valid[idx + 1];
        if (!nextCapture) break; // nothing after the last capture yet
        if (dates.get(nextCapture)!.has(vin)) continue; // still present, no episode

        const key = `${dealerId}|${vin}|${last}`;
        if (seenKeys.has(key)) continue; // an episode is only ever counted once
        seenKeys.add(key);

        const lastSeenAt = captureAt.get(`${dealerId}|${last}`) ?? null;
        const episode: DepartureEpisode = {
          dealerId,
          vehicleId: vin,
          lastSeen: last,
          lastSeenAt,
          firstAbsentCapture: nextCapture,
          confirmedOn: null,
          confirmedAt: null,
          elapsedHoursAtConfirmation: null,
          confirmationBasis: null,
          dateBoundariesAtConfirmation: null,
          status: "pending",
          lastAdvertisedPrice: priceAt.get(`${dealerId}|${vin}|${last}`) ?? null,
          returnedOn: null,
          dated: shiftDate(last, 1) === nextCapture,
          reportingMonth: nextCapture.slice(0, 7),
          inReportingPeriod: nextCapture >= reportingStart && nextCapture <= reportingEnd,
          key,
        };

        // Ownership-group transfer: the vehicle surfaced at a sibling after it
        // left here. Never a sale, regardless of timing.
        const movedWithinGroup = siblings.some((sib) =>
          [...(byDealer.get(sib) ?? new Map()).entries()].some(
            ([d, vins]) => d > last && (vins as Set<number>).has(vin),
          ),
        );
        if (movedWithinGroup) {
          episode.status = "transfer";
          if (episode.inReportingPeriod) result.excludedTransfers += 1;
          result.episodes.push(episode);
          break; // the vehicle's story continues at the sibling, not here
        }

        // Walk forward through verified captures looking for confirmation.
        const returnDay = presentOn.find((d) => d > last) ?? null;
        for (let j = idx + 1; j < valid.length; j++) {
          const day = valid[j];
          if (dates.get(day)!.has(vin)) break; // returned before confirming
          const at = captureAt.get(`${dealerId}|${day}`) ?? null;
          const hours = hoursBetween(lastSeenAt, at);
          // Boundaries are measured from the first verified absence, which is
          // the earliest moment the vehicle is known to have been gone.
          const boundaries = dateRange(episode.firstAbsentCapture!, day).length - 1;

          const qualifies =
            hours !== null
              ? hours >= confirmationHours
              : boundaries >= boundaryThreshold;

          if (qualifies) {
            episode.status = "confirmed";
            episode.confirmedOn = day;
            episode.confirmedAt = at;
            episode.elapsedHoursAtConfirmation = hours;
            episode.dateBoundariesAtConfirmation = boundaries;
            episode.confirmationBasis = hours !== null ? "timestamp" : "date_boundary";
            break;
          }
        }

        if (episode.status === "pending" && returnDay) {
          // Came back before any capture could confirm it — not a sale.
          episode.status = "voided";
          episode.returnedOn = returnDay;
          if (episode.inReportingPeriod) result.voided += 1;
        } else if (episode.status === "confirmed" && returnDay) {
          // The return may land in a LATER month than the departure. Because
          // the evidence window runs past the reporting period, that return
          // is visible here and reverses the original month's sale.
          const daysBack = dateRange(episode.confirmedOn!, returnDay).length - 1;
          if (daysBack >= 0 && daysBack <= unwindDays) {
            episode.status = "unwound";
            episode.returnedOn = returnDay;
            if (episode.inReportingPeriod) result.unwound += 1;
          }
        }

        // Counters describe the REPORTING period only. An episode outside it
        // is retained on the record but contributes nothing, so widening the
        // evidence window never inflates a month.
        if (episode.inReportingPeriod) {
          if (episode.status === "confirmed") result.confirmedEstimatedSales += 1;
          else if (episode.status === "pending") result.pendingDepartures += 1;
        }

        result.episodes.push(episode);
      }
    }

    // Potential Sales. An episode occupies exactly one of the two buckets, so
    // a pending departure becoming confirmed moves it across without changing
    // this total.
    result.potentialSales = result.confirmedEstimatedSales + result.pendingDepartures;

    // Advertised prices, confirmed sales only. Missing prices are excluded,
    // never substituted with zero.
    const confirmed = result.episodes.filter(
      (e) => e.status === "confirmed" && e.inReportingPeriod,
    );
    const priced = confirmed
      .map((e) => e.lastAdvertisedPrice)
      .filter((p): p is number => p != null);
    result.advertised = {
      pricedCount: priced.length,
      missingPriceCount: confirmed.length - priced.length,
      totalAdvertised: priced.reduce((a, b) => a + b, 0),
      avgAdvertised:
        priced.length > 0 ? priced.reduce((a, b) => a + b, 0) / priced.length : null,
    };

    // Projections and sell-through use CONFIRMED sales only, and are withheld
    // entirely when the month cannot be trusted.
    if (completeness.status !== "incomplete") {
      const elapsedDays = dateRange(reportingStart, reportingEnd).length;
      const [y, m] = reportingEnd.split("-").map(Number);
      const daysInMonth = new Date(Date.UTC(y, m, 0)).getUTCDate();
      result.projectedMonthlySales =
        elapsedDays > 0
          ? Math.round((result.confirmedEstimatedSales / elapsedDays) * daysInMonth)
          : 0;
      result.sellThroughPct =
        result.inventoryOnLastCapture > 0
          ? (result.confirmedEstimatedSales / result.inventoryOnLastCapture) * 100
          : null;
    }

    perDealer.push(result);
  }

  const totals = perDealer.reduce(
    (a, d) => ({
      confirmedEstimatedSales: a.confirmedEstimatedSales + d.confirmedEstimatedSales,
      pendingDepartures: a.pendingDepartures + d.pendingDepartures,
      potentialSales: a.potentialSales + d.potentialSales,
      unwound: a.unwound + d.unwound,
      voided: a.voided + d.voided,
      excludedTransfers: a.excludedTransfers + d.excludedTransfers,
    }),
    {
      confirmedEstimatedSales: 0,
      pendingDepartures: 0,
      potentialSales: 0,
      unwound: 0,
      voided: 0,
      excludedTransfers: 0,
    },
  );

  return {
    windowStart: opts.windowStart,
    windowEnd: opts.windowEnd,
    reportingStart,
    reportingEnd,
    confirmationHours,
    perDealer,
    totals,
    incompleteDealerIds: perDealer
      .filter((d) => d.completeness.status === "incomplete")
      .map((d) => d.dealerId),
    atRiskDealerIds: perDealer
      .filter((d) => d.completeness.status === "at_risk")
      .map((d) => d.dealerId),
  };
}
