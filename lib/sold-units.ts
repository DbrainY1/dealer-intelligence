// One source of truth for "units sold" across every DealerIQ surface.
//
// Two populations exist and they must never be silently mixed:
//
//   VERIFIED  — scraper dealers. DBRAIN resolves a canonical `sold` event and
//               monthly_sales carries the count. Unchanged by this module.
//   ESTIMATED — dealer-supplied feeds (HomeNet). DBRAIN deliberately emits no
//               canonical sold event for them (unified_event_resolver.py:336-339),
//               so monthly_sales has no row at all and every surface rendered a
//               blank or a zero. The estimate is the Estimated Departures figure
//               already computed in lib/estimated-departures.ts.
//
// This module only READS. It creates no event, writes no row, and does not
// touch monthly_sales or inventory_events.
//
// Attribution is DealerIQ's existing inventory-origin rule: a vehicle counts
// against the store that last held it. No selling-store logic, no DMS
// reconciliation.
//
// Every caller takes its figure from here so periods and denominators cannot
// drift: both populations are month-to-date on the Pacific calendar, and the
// estimator reuses the same confirmation, transfer-exclusion and coverage rules.

import { pacificDateStr } from "./dates.ts";
import { fetchAllRows } from "./fetch-all.ts";
import type { SupabaseLike } from "./dealer-freshness.ts";
import { loadEstimatedDepartures, HOMENET_FEED, FEED_GROUPS } from "./estimated-departures-data.ts";
import type { DepartureReport, DepartedVin } from "./estimated-departures.ts";

export type SoldBasis = "verified" | "estimated";

export interface SoldUnits {
  dealerId: number;
  /** Units for the period. Null means genuinely unknown, never a real zero. */
  units: number | null;
  basis: SoldBasis;
  /** Estimated only: departures not yet past the 72-hour confirmation. */
  pending: number;
  /** Estimated only: confirmed but not datable (vanished across a feed gap). */
  undated: number;
  /** Estimated only: the confirmed departures themselves. */
  departedVins: DepartedVin[];
  /** Estimated only: departures awaiting the 72-hour confirmation. */
  pendingVins: DepartedVin[];
}

export interface SoldUnitsResult {
  byDealer: Map<number, SoldUnits>;
  /** Full estimator output, for the panel and the coverage disclosure. */
  estimated: DepartureReport | null;
  /** Dealer ids served by an estimate rather than a verified count. */
  estimatedDealerIds: number[];
  monthStart: string;
  through: string;
}

/** True when this dealer's units come from the estimator. */
export function isFeedDealer(dealerId: number): boolean {
  return FEED_GROUPS.some((g) => g.dealerIds.includes(dealerId));
}

/** Short suffix for a figure, e.g. "24 est." — empty for verified counts. */
export function soldBasisSuffix(basis: SoldBasis): string {
  return basis === "estimated" ? "est." : "";
}

/**
 * Render a sold figure for a table cell.
 *
 * Preserves the existing distinction between a real zero and an absent value:
 * a verified dealer with no monthly_sales row still shows "—", never "0".
 */
export function formatSoldCell(s: SoldUnits | undefined): {
  text: string;
  isEstimate: boolean;
} {
  if (!s || s.units === null) return { text: "—", isEstimate: false };
  return { text: String(s.units), isEstimate: s.basis === "estimated" };
}

/**
 * Month-to-date units for every dealer in `dealerIds`.
 *
 * Verified dealers come from monthly_sales. Feed dealers come from the shared
 * estimator — the same calculation the Estimated Departures panel renders, not
 * a second implementation of it.
 */
export async function loadSoldUnits(
  supabase: SupabaseLike,
  dealerIds: number[],
  now: Date = new Date(),
  /** Override the feed-dealer set. Defaults to the configured FEED_GROUPS. */
  feedDealerIds?: number[],
  /**
   * An estimator report already loaded by the caller this request. Supplying
   * it avoids running the estimator twice on a page that also renders the
   * Estimated Departures panel.
   */
  preloadedReport?: DepartureReport | null,
): Promise<SoldUnitsResult> {
  const through = pacificDateStr(now);
  const monthStart = `${through.slice(0, 7)}-01`;

  const isFeed = feedDealerIds
    ? (id: number) => feedDealerIds.includes(id)
    : isFeedDealer;
  const feedIds = dealerIds.filter(isFeed);
  const verifiedIds = dealerIds.filter((id) => !isFeed(id));

  const [verifiedRows, estimated] = await Promise.all([
    verifiedIds.length > 0
      ? fetchAllRows<{ dealer_id: number; units_sold: number | null }>(
          "sold units (verified)",
          (from, to) =>
            supabase
              .from("monthly_sales")
              .select("dealer_id, units_sold")
              .eq("month_start", monthStart)
              .in("dealer_id", verifiedIds)
              .range(from, to),
        )
      : Promise.resolve([]),
    feedIds.length === 0
      ? Promise.resolve(null)
      : preloadedReport
        ? Promise.resolve(preloadedReport)
        : loadEstimatedDepartures(supabase, HOMENET_FEED, now),
  ]);

  const byDealer = new Map<number, SoldUnits>();

  for (const r of verifiedRows) {
    byDealer.set(r.dealer_id, {
      dealerId: r.dealer_id,
      units: r.units_sold ?? 0,
      basis: "verified",
      pending: 0,
      undated: 0,
      departedVins: [],
      pendingVins: [],
    });
  }

  if (estimated) {
    for (const d of estimated.perDealer) {
      if (!dealerIds.includes(d.dealerId)) continue;
      byDealer.set(d.dealerId, {
        dealerId: d.dealerId,
        units: d.estimatedDepartures,
        basis: "estimated",
        pending: d.pendingConfirmation,
        undated: d.confirmedUndated,
        departedVins: d.departedVins,
        pendingVins: d.pendingVins,
      });
    }
  }

  return {
    byDealer,
    estimated,
    estimatedDealerIds: feedIds.filter((id) => byDealer.has(id)),
    monthStart,
    through,
  };
}

/**
 * Total units across `dealerIds`, counting each dealer once.
 *
 * Feed dealers in the same group are de-duplicated against the estimator's
 * group roll-up: the per-store figures are inventory-origin counts, so a
 * vehicle listed at two stores at once would otherwise be counted twice. The
 * group total is the sum of the store estimates unless the estimator actually
 * found an overlap, in which case the smaller de-duplicated figure wins.
 */
export function sumSoldUnits(
  result: SoldUnitsResult,
  dealerIds: number[],
): { total: number; verified: number; estimated: number; deduplicatedBy: number } {
  let verified = 0;
  let estimatedSum = 0;
  for (const id of dealerIds) {
    const s = result.byDealer.get(id);
    if (!s || s.units === null) continue;
    if (s.basis === "verified") verified += s.units;
    else estimatedSum += s.units;
  }

  // Apply the group de-duplication safeguard only when every member of the
  // feed group is included, otherwise a partial selection would be compared
  // against a whole-group figure.
  let deduplicatedBy = 0;
  const g = result.estimated?.group;
  if (g && g.dealerIds.every((id) => dealerIds.includes(id))) {
    const overlap = g.perDealerSum - g.estimatedDepartures;
    if (overlap > 0) {
      estimatedSum -= overlap;
      deduplicatedBy = overlap;
    }
  }

  return { total: verified + estimatedSum, verified, estimated: estimatedSum, deduplicatedBy };
}
