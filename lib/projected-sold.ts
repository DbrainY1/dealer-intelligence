import type { InventoryEvent } from "@/types";

// Estimated Sales / Daily Sold implements the V2 read-layer projected-sold rule
// from DBRAIN_V2_CUTOVER_NOTES.md and matches the DBRAIN Daily Market Movement
// email logic.
// Confirmed Sold + Pending Sale, deduplicated by vehicle, sold preferred,
// transfers excluded, from_dealer_id attribution.
// MTD Sold continues to use monthly_sales / resolved_at and is unchanged.

/**
 * Merge Confirmed Sold (`sold`) and Pending Sale (unresolved `pending_removal`)
 * rows into one projected-sold list:
 *   - deduplicated by vehicle_id (a sold row wins over a pending_removal row),
 *   - excluding any vehicle that has a `transferred` row in the same window.
 * Callers attribute the selling dealer via `from_dealer_id`.
 */
export function dedupeProjectedSold(
  soldRows: InventoryEvent[],
  pendingRows: InventoryEvent[],
  transferredVehicleIds: Set<number>
): InventoryEvent[] {
  const byVehicle = new Map<number, InventoryEvent>();
  // Pending first, then sold overwrites — sold is preferred over pending_removal.
  for (const r of pendingRows) {
    if (r.vehicle_id != null && !transferredVehicleIds.has(r.vehicle_id)) {
      byVehicle.set(r.vehicle_id, r);
    }
  }
  for (const r of soldRows) {
    if (r.vehicle_id != null && !transferredVehicleIds.has(r.vehicle_id)) {
      byVehicle.set(r.vehicle_id, r);
    }
  }
  return [...byVehicle.values()];
}
