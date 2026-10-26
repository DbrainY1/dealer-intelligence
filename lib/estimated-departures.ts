// Estimated Departures for dealer-supplied inventory feeds.
//
// A feed dealer (HomeNet today) publishes its own inventory. DBRAIN's
// unified_event_resolver deliberately never emits a canonical `sold` event for
// these dealers — a VIN leaving a dealer-supplied feed is not proof of a
// retail sale (unified_event_resolver.py:336-339, "HomeNet non-transfer
// departure: never a sale"). So `monthly_sales` has no row for them at all.
//
// This module derives a SEPARATE, clearly-labelled estimate from the VIN
// snapshots themselves. It is read-only arithmetic:
//
//   * it writes nothing, anywhere;
//   * it never emits or reclassifies a lifecycle event;
//   * canonical `sold` events and `monthly_sales` are untouched;
//   * the output is "Estimated Departures", never "sales".
//
// It is generic over any set of feed dealers so a future dealer-supplied feed
// reuses it by passing different ids — nothing here is HomeNet-specific.
//
// ── Confirmation rule ──────────────────────────────────────────────────────
// A departure is CONFIRMED only when both hold:
//   1. elapsed time since the VIN was last seen >= confirmationDays, and
//   2. the dealer has at least that many VALID capture days after it was last
//      seen (i.e. the absence is backed by real captures, not by silence).
// Missing capture days are never counted as evidence of absence.
//
// ── Departure dating ───────────────────────────────────────────────────────
// If the day immediately after the VIN was last seen is itself a valid capture
// day, the departure date is known. If that day falls inside a capture gap the
// departure is reported as DATE UNDETERMINED. A date is never invented for a
// VIN that vanished across a blackout.

import { shiftDate } from "./dealer-freshness.ts";

export interface FeedSnapshotRow {
  dealer_id: number;
  snapshot_date: string;
  vehicle_id: number;
  /**
   * Advertised list price on that capture day, when selected. Used only to
   * carry each departed vehicle's LAST ADVERTISED price through to the UI.
   * It is an asking price, never a transacted amount.
   */
  list_price?: number | null;
}

/** A single vehicle the estimator classified, with its last advertised price. */
export interface DepartedVin {
  vehicleId: number;
  /** Last capture day this store held the vehicle. */
  lastSeen: string;
  /** Advertised price on that last capture. Null when never advertised. */
  lastAdvertisedPrice: number | null;
  /** False when the departure fell into a capture gap and cannot be dated. */
  dated: boolean;
}

export interface DepartureOptions {
  /** Dealers belonging to one feed group. Movement between them is a transfer. */
  feedDealerIds: number[];
  windowStart: string;
  /** Last day of evidence, inclusive (normally "today" in Pacific). */
  windowEnd: string;
  /** Consecutive valid days of absence required to confirm. 3 = 72 hours. */
  confirmationDays?: number;
}

export interface CoverageGap {
  start: string;
  end: string;
  days: number;
}

export interface FeedCoverage {
  expectedDays: number;
  presentDays: number;
  missingDays: string[];
  gaps: CoverageGap[];
  complete: boolean;
  firstValidDay: string | null;
  lastValidDay: string | null;
  /** True when the final expected day produced no rows — the feed is down now. */
  feedFailedOnLastExpectedDay: boolean;
}

export interface DealerDepartures {
  dealerId: number;
  coverage: FeedCoverage;
  /** Confirmed, departure date observed. */
  confirmedDated: number;
  /** Confirmed by post-gap absence, but the departure date is unknowable. */
  confirmedUndated: number;
  /** confirmedDated + confirmedUndated — the headline estimate. */
  estimatedDepartures: number;
  /** Absent, but not yet backed by enough valid capture days. */
  pendingConfirmation: number;
  excludedTransfer: number;
  excludedRelist: number;
  /** Of `estimatedDepartures`, how many first appeared after windowStart. */
  ofWhichArrivedMidWindow: number;
  /** VIN rows discarded as duplicates (same VIN twice on one dealer-day). */
  duplicateVinRows: number;
  /** VINs still present on the dealer's last valid day. */
  retained: number;
  /**
   * The confirmed departures themselves. length === estimatedDepartures by
   * construction — the same loop increments the counter and appends here.
   */
  departedVins: DepartedVin[];
  /** Absent but not yet past the 72-hour confirmation. */
  pendingVins: DepartedVin[];
}

/**
 * Group-level roll-up: unique VINs that left the feed group entirely.
 *
 * The per-dealer figures answer "where was this vehicle last held", so summing
 * them can count one VIN twice if it was listed at two stores at once. The
 * group figure counts each VIN once, treating the group as a single lot: a VIN
 * has departed only when it is absent from EVERY member store.
 *
 * Evidence is restricted to group-complete days — days on which every
 * participating store captured. A day where one store is dark cannot prove a
 * vehicle left the group, only that one store went quiet.
 */
export interface GroupDepartures {
  dealerIds: number[];
  /** Days on which every participating store captured. */
  groupValidDays: number;
  coverage: FeedCoverage;
  /** Unique VINs confirmed gone from the whole group — the headline figure. */
  estimatedDepartures: number;
  confirmedDated: number;
  confirmedUndated: number;
  pendingConfirmation: number;
  retained: number;
  ofWhichArrivedMidWindow: number;
  /** Sum of the per-dealer figures, before de-duplication. */
  perDealerSum: number;
  /** perDealerSum − estimatedDepartures: VINs that would have been counted twice. */
  crossStoreDuplicatesRemoved: number;
}

export interface DepartureReport {
  windowStart: string;
  windowEnd: string;
  confirmationDays: number;
  group: GroupDepartures;
  perDealer: DealerDepartures[];
  totals: {
    estimatedDepartures: number;
    confirmedDated: number;
    confirmedUndated: number;
    pendingConfirmation: number;
    excludedTransfer: number;
    excludedRelist: number;
  };
  /** Dealers whose feed produced nothing on the final expected day. */
  feedFailures: number[];
  /** True when every feed dealer has a complete capture window. */
  coverageComplete: boolean;
}

/** Every date from `start` to `end` inclusive. */
export function dateRange(start: string, end: string): string[] {
  const out: string[] = [];
  for (let d = start; d <= end; d = shiftDate(d, 1)) out.push(d);
  return out;
}

function buildCoverage(
  validDays: Set<string>,
  expected: string[],
): FeedCoverage {
  const missingDays = expected.filter((d) => !validDays.has(d));
  const present = expected.filter((d) => validDays.has(d));

  const gaps: CoverageGap[] = [];
  for (const d of missingDays) {
    const last = gaps[gaps.length - 1];
    if (last && shiftDate(last.end, 1) === d) {
      last.end = d;
      last.days += 1;
    } else {
      gaps.push({ start: d, end: d, days: 1 });
    }
  }

  const lastExpected = expected[expected.length - 1];
  return {
    expectedDays: expected.length,
    presentDays: present.length,
    missingDays,
    gaps,
    complete: missingDays.length === 0,
    firstValidDay: present[0] ?? null,
    lastValidDay: present[present.length - 1] ?? null,
    feedFailedOnLastExpectedDay: lastExpected ? !validDays.has(lastExpected) : false,
  };
}

/**
 * Derive estimated departures for one feed group.
 *
 * Pure: callers supply the snapshot rows. Each VIN is classified exactly once
 * per dealer, so a VIN that arrives mid-window and then departs is counted in
 * the same bucket as one present from day one — never in both.
 */
export function computeEstimatedDepartures(
  rows: FeedSnapshotRow[],
  opts: DepartureOptions,
): DepartureReport {
  const confirmationDays = opts.confirmationDays ?? 3;
  const expected = dateRange(opts.windowStart, opts.windowEnd);

  // dealer -> date -> VIN set, plus a duplicate tally.
  const byDealer = new Map<number, Map<string, Set<number>>>();
  // dealer -> "vin|date" -> advertised price on that capture day
  const priceByDealerVinDate = new Map<number, Map<string, number | null>>();
  const duplicates = new Map<number, number>();
  for (const id of opts.feedDealerIds) {
    byDealer.set(id, new Map());
    priceByDealerVinDate.set(id, new Map());
    duplicates.set(id, 0);
  }

  for (const r of rows) {
    const dates = byDealer.get(r.dealer_id);
    if (!dates) continue; // not a feed dealer
    if (r.snapshot_date < opts.windowStart || r.snapshot_date > opts.windowEnd) continue;
    let set = dates.get(r.snapshot_date);
    if (!set) {
      set = new Set();
      dates.set(r.snapshot_date, set);
    }
    if (set.has(r.vehicle_id)) duplicates.set(r.dealer_id, (duplicates.get(r.dealer_id) ?? 0) + 1);
    set.add(r.vehicle_id);
    if (r.list_price !== undefined) {
      priceByDealerVinDate
        .get(r.dealer_id)!
        .set(`${r.vehicle_id}|${r.snapshot_date}`, r.list_price);
    }
  }

  // Group-wide presence: date -> VINs anywhere in the feed group. Used to spot
  // a VIN that moved between feed dealers rather than leaving the group.
  const groupByDate = new Map<string, Set<number>>();
  for (const dates of byDealer.values()) {
    for (const [date, vins] of dates) {
      let g = groupByDate.get(date);
      if (!g) {
        g = new Set();
        groupByDate.set(date, g);
      }
      for (const v of vins) g.add(v);
    }
  }

  const perDealer: DealerDepartures[] = [];

  for (const dealerId of opts.feedDealerIds) {
    const dates = byDealer.get(dealerId)!;
    const validDays = new Set([...dates.keys()].filter((d) => (dates.get(d)?.size ?? 0) > 0));
    const coverage = buildCoverage(validDays, expected);
    const validSorted = [...validDays].sort();

    const result: DealerDepartures = {
      dealerId,
      coverage,
      confirmedDated: 0,
      confirmedUndated: 0,
      estimatedDepartures: 0,
      pendingConfirmation: 0,
      excludedTransfer: 0,
      excludedRelist: 0,
      ofWhichArrivedMidWindow: 0,
      duplicateVinRows: duplicates.get(dealerId) ?? 0,
      retained: 0,
      departedVins: [],
      pendingVins: [],
    };

    if (validSorted.length === 0) {
      perDealer.push(result);
      continue;
    }

    // First/last valid day the dealer saw each VIN, and whether it ever
    // returned after an absence (a relist).
    const firstSeen = new Map<number, string>();
    const lastSeen = new Map<number, string>();
    const seenDayCount = new Map<number, number>();
    for (const day of validSorted) {
      for (const vin of dates.get(day)!) {
        if (!firstSeen.has(vin)) firstSeen.set(vin, day);
        lastSeen.set(vin, day);
        seenDayCount.set(vin, (seenDayCount.get(vin) ?? 0) + 1);
      }
    }
    // Advertised price on each VIN's most recent capture at this store.
    const lastPrice = priceByDealerVinDate.get(dealerId) ?? new Map();

    const finalValidDay = validSorted[validSorted.length - 1];

    for (const [vin, last] of lastSeen) {
      // Still on the lot on the dealer's most recent capture — not a departure.
      if (dates.get(finalValidDay)!.has(vin)) {
        result.retained += 1;
        continue;
      }

      // Returned at least once after dropping out mid-window: a relist. Its
      // final disappearance is still evaluated below, so count the relist as
      // context, not as an exclusion from the departure maths.
      const spanDays = validSorted.filter((d) => d >= firstSeen.get(vin)! && d <= last).length;
      const relisted = spanDays > (seenDayCount.get(vin) ?? 0);
      if (relisted) result.excludedRelist += 1;

      // Appeared at a sibling feed dealer after leaving this one → transfer.
      let movedWithinGroup = false;
      for (const [date, vins] of groupByDate) {
        if (date > last && vins.has(vin)) {
          // confirm it is at a DIFFERENT dealer on that date
          for (const otherId of opts.feedDealerIds) {
            if (otherId === dealerId) continue;
            if (byDealer.get(otherId)?.get(date)?.has(vin)) {
              movedWithinGroup = true;
              break;
            }
          }
        }
        if (movedWithinGroup) break;
      }
      if (movedWithinGroup) {
        result.excludedTransfer += 1;
        continue;
      }

      // Confirmation: valid capture days after `last`, and elapsed time.
      const validDaysAfter = validSorted.filter((d) => d > last).length;
      const elapsedDays = dateRange(last, opts.windowEnd).length - 1;

      const dated = validDays.has(shiftDate(last, 1));
      const record: DepartedVin = {
        vehicleId: vin,
        lastSeen: last,
        lastAdvertisedPrice: lastPrice.get(`${vin}|${last}`) ?? null,
        dated,
      };

      if (validDaysAfter >= confirmationDays && elapsedDays >= confirmationDays) {
        // Dated only when the very next day was actually captured. If the VIN
        // vanished into a gap we confirm the departure but refuse to date it.
        if (dated) result.confirmedDated += 1;
        else result.confirmedUndated += 1;
        result.departedVins.push(record);

        if (firstSeen.get(vin)! > opts.windowStart) result.ofWhichArrivedMidWindow += 1;
      } else {
        result.pendingConfirmation += 1;
        result.pendingVins.push(record);
      }
    }

    result.estimatedDepartures = result.confirmedDated + result.confirmedUndated;
    perDealer.push(result);
  }

  // ── Group roll-up: unique VINs gone from every member store ───────────────
  //
  // Only stores that produced data in the window participate; a store with no
  // rows at all cannot constrain the group's evidence.
  const participating = opts.feedDealerIds.filter(
    (id) => (byDealer.get(id)?.size ?? 0) > 0,
  );

  const groupValidDays = expected.filter((d) =>
    participating.every((id) => (byDealer.get(id)?.get(d)?.size ?? 0) > 0),
  );
  const groupValidSet = new Set(groupValidDays);
  const groupCoverage = buildCoverage(groupValidSet, expected);

  const groupLastSeen = new Map<number, string>();
  const groupFirstSeen = new Map<number, string>();
  for (const day of groupValidDays) {
    for (const vin of groupByDate.get(day) ?? []) {
      if (!groupFirstSeen.has(vin)) groupFirstSeen.set(vin, day);
      groupLastSeen.set(vin, day);
    }
  }

  const perDealerSum = perDealer.reduce((a, d) => a + d.estimatedDepartures, 0);
  const group: GroupDepartures = {
    dealerIds: opts.feedDealerIds,
    groupValidDays: groupValidDays.length,
    coverage: groupCoverage,
    estimatedDepartures: 0,
    confirmedDated: 0,
    confirmedUndated: 0,
    pendingConfirmation: 0,
    retained: 0,
    ofWhichArrivedMidWindow: 0,
    perDealerSum,
    crossStoreDuplicatesRemoved: 0,
  };

  if (groupValidDays.length > 0) {
    const finalGroupDay = groupValidDays[groupValidDays.length - 1];
    const stillHere = groupByDate.get(finalGroupDay) ?? new Set<number>();

    for (const [vin, last] of groupLastSeen) {
      if (stillHere.has(vin)) {
        group.retained += 1;
        continue;
      }
      const validDaysAfter = groupValidDays.filter((d) => d > last).length;
      const elapsedDays = dateRange(last, opts.windowEnd).length - 1;

      if (validDaysAfter >= confirmationDays && elapsedDays >= confirmationDays) {
        if (groupValidSet.has(shiftDate(last, 1))) group.confirmedDated += 1;
        else group.confirmedUndated += 1;
        if (groupFirstSeen.get(vin)! > opts.windowStart) group.ofWhichArrivedMidWindow += 1;
      } else {
        group.pendingConfirmation += 1;
      }
    }
  }

  group.estimatedDepartures = group.confirmedDated + group.confirmedUndated;
  group.crossStoreDuplicatesRemoved = perDealerSum - group.estimatedDepartures;

  const totals = perDealer.reduce(
    (a, d) => ({
      estimatedDepartures: a.estimatedDepartures + d.estimatedDepartures,
      confirmedDated: a.confirmedDated + d.confirmedDated,
      confirmedUndated: a.confirmedUndated + d.confirmedUndated,
      pendingConfirmation: a.pendingConfirmation + d.pendingConfirmation,
      excludedTransfer: a.excludedTransfer + d.excludedTransfer,
      excludedRelist: a.excludedRelist + d.excludedRelist,
    }),
    {
      estimatedDepartures: 0,
      confirmedDated: 0,
      confirmedUndated: 0,
      pendingConfirmation: 0,
      excludedTransfer: 0,
      excludedRelist: 0,
    },
  );

  return {
    windowStart: opts.windowStart,
    windowEnd: opts.windowEnd,
    confirmationDays,
    group,
    perDealer,
    totals,
    feedFailures: perDealer
      .filter((d) => d.coverage.feedFailedOnLastExpectedDay)
      .map((d) => d.dealerId),
    coverageComplete: perDealer.every((d) => d.coverage.complete),
  };
}
