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
  vin: string;
  year: number;
  make: string;
  model: string;
  trim: string | null;
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
