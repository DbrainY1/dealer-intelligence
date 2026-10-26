// Pure aggregation helpers for the Market Overview dashboard
// (app/dashboard/page.tsx).
//
// These were extracted verbatim from the inline page logic so the behavior can
// be pinned by regression tests before the data-fetching layer underneath them
// is changed. Every rule here is intentional and load-bearing:
//
//   - A dealer with no inventory snapshot reports zeros for BOTH count and
//     sold, even when a monthly_sales row exists for it. (The original code
//     early-returned before reading monthly_sales.)
//   - The canonical partial-month cutoff is derived from projection_cutoff on
//     canonical rows only — never hardcoded.
//   - Sell-through is null (not 0) when the inputs cannot support it.
//   - Average price is a flat mean over every priced snapshot row across all
//     dealers, not a mean of per-dealer means.
//
// No I/O here — callers supply already-fetched rows.

// Relative + extensioned so this module runs unchanged under
// `node --experimental-strip-types --test` as well as through the bundler.
import { isCanonicalRow } from "./cutoff.ts";
import type { DailySoldVehicle } from "@/app/dashboard/MarketCharts";
import type { InventoryEvent } from "@/types";

export interface MonthlySalesRow {
  dealer_id: number;
  units_sold: number | null;
  month_start: string;
  computed_by: string | null;
  projection_cutoff: string | null;
}

/** dealer_id + list_price is all the snapshot data the dashboard aggregates. */
export interface SnapshotMetricRow {
  dealer_id: number;
  list_price: number | null;
}

export interface DealerRow {
  name: string;
  count: number;
  sold: number;
  /** Whether `sold` is a verified count or an estimate. */
  soldBasis: "verified" | "estimated" | "estimated_v2";
  /**
   * Estimated dealers only: departures detected but not yet 72 hours old.
   * Daily Sold is unavailable for these dealers — a same-day departure cannot
   * be confirmed the same day — so the UI shows this instead of a false zero.
   */
  pendingConfirmation: number;
  added: number;
  transferred: number;
  dailySold: number;
  dailySoldVehicles: DailySoldVehicle[];
}

export interface SnapshotStats {
  activeDealers: number;
  inventory: number;
  avgPrice: number | null;
}

export interface VehicleDetail {
  year: number | null;
  make: string | null;
  model: string | null;
  vin: string | null;
  mileage: number | null;
}

/**
 * Canonical partial-month cutoff for `monthStart`, or null when the month has
 * no canonical row. Derived from projection_cutoff — never hardcoded.
 */
export function deriveCanonicalCutoff(
  rows: MonthlySalesRow[],
  monthStart: string
): string | null {
  return (
    rows
      .filter((r) => r.month_start === monthStart)
      .map((r) => (isCanonicalRow(r.computed_by) ? r.projection_cutoff : null))
      .find((c): c is string => c != null) ?? null
  );
}

/** Total units_sold across every dealer for one month_start. */
export function sumSoldForMonth(rows: MonthlySalesRow[], monthStart: string): number {
  return rows
    .filter((r) => r.month_start === monthStart)
    .reduce((s, r) => s + (r.units_sold ?? 0), 0);
}

/**
 * Group projected-sold events by selling dealer (from_dealer_id), attaching
 * vehicle detail for the expandable Daily Sold rows.
 *
 * Price precedence is last_seen_price → price_at_listing → null, matching the
 * DBRAIN Daily Market Movement email.
 */
export function groupDailySoldByDealer(
  projected: InventoryEvent[],
  vehicleMap: Map<number, VehicleDetail>
): Map<number, { count: number; vehicles: DailySoldVehicle[] }> {
  const byDealer = new Map<number, { count: number; vehicles: DailySoldVehicle[] }>();
  for (const e of projected) {
    const did = e.from_dealer_id;
    if (did == null) continue;
    const veh = vehicleMap.get(e.vehicle_id);
    const entry = byDealer.get(did) ?? { count: 0, vehicles: [] };
    entry.count += 1;
    entry.vehicles.push({
      year: veh?.year ?? null,
      make: veh?.make ?? null,
      model: veh?.model ?? null,
      trim: null, // Not captured upstream; intentionally blank (matches DBRAIN email).
      mileage: veh?.mileage ?? null,
      vin: veh?.vin ?? null,
      price: e.last_seen_price ?? e.price_at_listing ?? null,
      date: e.event_date,
    });
    byDealer.set(did, entry);
  }
  return byDealer;
}

/**
 * Per-dealer table rows.
 *
 * `inventoryByDealer` must contain an entry only for dealers that have at least
 * one inventory snapshot. A dealer missing from it reports zeros for count AND
 * sold — preserving the original early-return, where a dealer without snapshots
 * never reached its monthly_sales lookup.
 */
export function buildDealerRows(
  dealers: { id: number; name: string }[],
  inventoryByDealer: Map<number, number>,
  /** Units per dealer from lib/sold-units — verified or estimated. */
  soldByDealer: Map<number, { units: number | null; basis: "verified" | "estimated" | "estimated_v2"; pending?: number }>,
  addedByDealer: Map<number, number>,
  transferredByDealer: Map<number, number>,
  dailyByDealer: Map<number, { count: number; vehicles: DailySoldVehicle[] }>
): DealerRow[] {
  return dealers.map((d) => {
    const dailySold = dailyByDealer.get(d.id)?.count ?? 0;
    const dailySoldVehicles = dailyByDealer.get(d.id)?.vehicles ?? [];

    if (!inventoryByDealer.has(d.id)) {
      return { name: d.name, count: 0, sold: 0, soldBasis: "verified", pendingConfirmation: 0, added: 0, transferred: 0, dailySold, dailySoldVehicles };
    }

    const soldRow = soldByDealer.get(d.id);

    return {
      name: d.name,
      count: inventoryByDealer.get(d.id) ?? 0,
      sold: soldRow?.units ?? 0,
      soldBasis: soldRow?.basis ?? "verified",
      pendingConfirmation: soldRow?.pending ?? 0,
      added: addedByDealer.get(d.id) ?? 0,
      transferred: transferredByDealer.get(d.id) ?? 0,
      dailySold,
      dailySoldVehicles,
    };
  });
}

/**
 * Flat mean list price across every priced snapshot row, rounded. Returns 0
 * when nothing is priced — matching the original `totalPriceCount > 0 ? … : 0`.
 */
export function averageListPrice(rows: SnapshotMetricRow[]): number {
  let sum = 0;
  let count = 0;
  for (const r of rows) {
    if (r.list_price != null) {
      sum += r.list_price;
      count++;
    }
  }
  return count > 0 ? Math.round(sum / count) : 0;
}

/**
 * Comparison-period snapshot stats from every row on one snapshot date.
 *
 * avgPrice is null (not 0) when no row is priced, matching the original.
 */
export function aggregateSnapshotStats(rows: SnapshotMetricRow[]): SnapshotStats {
  const dealerIds = new Set<number>();
  let sum = 0;
  let priced = 0;
  for (const r of rows) {
    dealerIds.add(r.dealer_id);
    if (r.list_price != null) {
      sum += r.list_price;
      priced++;
    }
  }
  return {
    activeDealers: dealerIds.size,
    inventory: rows.length,
    avgPrice: priced > 0 ? Math.round(sum / priced) : null,
  };
}

/** Sell-through for the current period: null when inventory is absent. */
export function sellThroughToday(sold: number, inventory: number): number | null {
  return inventory > 0 ? (sold / inventory) * 100 : null;
}

/**
 * Sell-through for a comparison period. Null unless the period has stats, a
 * positive inventory, AND a positive sold count — the original collapsed every
 * other branch to null.
 */
export function sellThroughComparison(
  stats: SnapshotStats | null,
  sold: number
): number | null {
  if (stats && stats.inventory > 0 && sold > 0) {
    return (sold / stats.inventory) * 100;
  }
  return null;
}

/** Dealers reporting any inventory today. */
export function countActiveDealers(rows: DealerRow[]): number {
  return rows.filter((d) => d.count > 0).length;
}

/** Total inventory across every dealer row. */
export function sumInventory(rows: DealerRow[]): number {
  return rows.reduce((sum, d) => sum + d.count, 0);
}
