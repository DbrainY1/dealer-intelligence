export interface Dealer {
  id: string;
  name: string;
  group_id: string | null;
  city: string | null;
}

export interface DealerGroup {
  id: string;
  name: string;
}

export interface Vehicle {
  vin: string;
  year: number;
  make: string;
  model: string;
  trim: string | null;
}

export interface InventorySnapshot {
  id: string;
  dealer_id: string;
  vin: string;
  list_price: number | null;
  days_on_lot: number | null;
  status: string | null;
  snapshot_date: string;
}

export interface VinPresence {
  vin: string;
  dealer_id: string;
  first_seen: string;
  last_seen: string;
}

export interface InventoryEvent {
  id: string;
  vin: string;
  dealer_id: string;
  event_type: "listed" | "removed" | "price_change";
  event_date: string;
  price: number | null;
}

export interface ScrapeLog {
  id: string;
  dealer_id: string;
  run_at: string;
  success: boolean;
  error_message: string | null;
}

export interface UserRole {
  user_id: string;
  role: "developer" | "owner" | "gm";
  dealer_id: string | null;
}
