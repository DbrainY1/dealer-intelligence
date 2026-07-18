export interface Dealer {
  id: number;
  name: string;
  dealer_group_id: number | null;
}

export interface DealerGroup {
  id: string;
  name: string;
}

export interface Vehicle {
  id: number;
  vin: string;
  year: number | null;
  make: string | null;
  model: string | null;
  ext_color: string | null;
  created_at: string;
}

export interface InventorySnapshot {
  id: string;
  dealer_id: number;
  dealer_group_id: number | null;
  vehicle_id: number;
  snapshot_date: string;
  list_price: number | null;
  mileage: number | null;
  stock_number: string | null;
  vehicle_url: string | null;
  photo_count: number | null;
  status: string | null;
  cost_basis: number | null;
  created_at: string;
}

export interface VinPresence {
  vin: string;
  dealer_id: string;
  first_seen: string;
  last_seen: string;
}

// Every event type produced by the pipeline (legacy + canonical eras).
export type InventoryEventType =
  | "added"
  | "removed"
  | "price_changed"
  | "sold"
  | "transferred"
  | "pending_removal"
  | "relist";

// PR-A lifecycle status. NULL/absent = legacy row (historical evidence only);
// set = canonical row (lifecycle truth).
export type InventoryEventStatus =
  | "pending_resolution"
  | "resolved"
  | "superseded"
  | "closed_unconfirmed";

export interface InventoryEvent {
  id: number;
  vehicle_id: number;
  to_dealer_id: number | null;
  dealer_id?: number; // Deprecated, use to_dealer_id
  dealer_group_id: number | null;
  event_type: InventoryEventType;
  event_date: string;
  from_dealer_id: number | null;
  old_price: number | null;
  new_price: number | null;
  price_at_listing: number | null;
  last_seen_price: number | null;
  last_seen_mileage: number | null;
  first_seen_date: string | null;
  // PR-A lifecycle fields — returned by select("*"); optional because some
  // surfaces select narrow column lists.
  event_status?: InventoryEventStatus | null;
  source_pending_event_id?: number | null;
  confidence?: string | null;
  reason_code?: string | null;
  excluded_from_metrics?: boolean | null;
  created_at?: string | null;
}

export interface ScrapeLog {
  id: number;
  dealer_id: number;
  run_at: string;
  vehicles_found: number | null;
  new_vehicles: number | null;
  status: "success" | "error";
  error_msg: string | null;
}

export interface UserRole {
  user_id: string;
  role: "developer" | "owner" | "gm";
  dealer_id: string | null;
}
