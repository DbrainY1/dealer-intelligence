import { createServerSupabase } from "@/lib/supabase-server";
import { VIN_GOLD } from "@/lib/vin";
import type { Vehicle, InventoryEvent, Dealer } from "@/types";

interface PageProps {
  params: { vin: string };
}

interface VinPresenceRow {
  vehicle_id: number;
  first_seen_dealer_id: number | null;
  last_seen_dealer_id: number | null;
  first_seen_date: string;
  last_seen_date: string;
  current_status: string | null;
}

export default async function VinDetailPage({ params }: PageProps) {
  const supabase = await createServerSupabase();
  const vin = params.vin;

  const { data: vehicle } = await supabase
    .from("vehicles")
    .select("*")
    .eq("vin", vin)
    .single<Vehicle>();

  const vehicleId = vehicle?.id;

  const [{ data: events }, { data: snaps }, { data: dealers }] = await Promise.all([
    vehicleId
      ? supabase.from("inventory_events").select("*").eq("vehicle_id", vehicleId).order("event_date", { ascending: true })
      : Promise.resolve({ data: [] }),
    // Dealer presence/history is derived from inventory_snapshots (authoritative
    // for presence). vin_presence is a lossy/derived cache that is often empty
    // for active vehicles, which caused "No presence data" for in-stock VINs.
    vehicleId
      ? supabase
          .from("inventory_snapshots")
          .select("dealer_id, snapshot_date, status")
          .eq("vehicle_id", vehicleId)
          .order("snapshot_date", { ascending: true })
      : Promise.resolve({ data: [] }),
    supabase.from("dealers").select("*"),
  ]);

  const eventList: InventoryEvent[] = events ?? [];
  const dealerList: Dealer[] = dealers ?? [];
  const snapList: { dealer_id: number; snapshot_date: string; status: string | null }[] = snaps ?? [];

  // Group this VIN's snapshots by dealer → first/last seen + whether it is in the
  // most recent snapshot (currently in stock).
  const latestSnapshotDate = snapList.length ? snapList[snapList.length - 1].snapshot_date : null;
  const presenceByDealer = new Map<number, { first: string; last: string; activeNow: boolean }>();
  for (const s of snapList) {
    const cur = presenceByDealer.get(s.dealer_id);
    if (!cur) {
      presenceByDealer.set(s.dealer_id, { first: s.snapshot_date, last: s.snapshot_date, activeNow: false });
    } else {
      cur.last = s.snapshot_date;
    }
  }
  for (const s of snapList) {
    if (s.snapshot_date === latestSnapshotDate && s.status === "active") {
      const cur = presenceByDealer.get(s.dealer_id);
      if (cur) cur.activeNow = true;
    }
  }
  const presenceList: VinPresenceRow[] = Array.from(presenceByDealer.entries()).map(([dealerId, p]) => ({
    vehicle_id: vehicleId ?? 0,
    first_seen_dealer_id: dealerId,
    last_seen_dealer_id: dealerId,
    first_seen_date: p.first,
    last_seen_date: p.last,
    current_status: p.activeNow ? "active" : "inactive",
  }));

  // Dealer where the VIN is in stock right now (present in the latest snapshot).
  const currentDealerId = presenceList.find((p) => p.current_status === "active")?.last_seen_dealer_id ?? null;

  const getDealerName = (id: number | null) =>
    id != null ? (dealerList.find((d) => d.id === id)?.name ?? `Dealer ${id}`) : "Unknown";

  const daysOnLot = presenceList.length
    ? Math.max(
        ...presenceList.map((p) => {
          const diff =
            (new Date(p.last_seen_date).getTime() - new Date(p.first_seen_date).getTime()) /
            (1000 * 60 * 60 * 24);
          return Math.round(diff);
        })
      )
    : null;

  return (
    <div className="p-6 space-y-6">
      <div>
        <p className="text-sm font-mono" style={{ color: VIN_GOLD }}>{vin}</p>
        <h1 className="text-white text-xl font-bold">
          {vehicle ? `${vehicle.year ?? ""} ${vehicle.make ?? ""} ${vehicle.model ?? ""}`.trim() : "VIN Detail"}
        </h1>
      </div>

      {currentDealerId != null && (
        <div className="bg-gray-900 border border-gray-800 rounded-lg p-3 inline-block">
          <span className="text-green-400 text-sm font-semibold">● Currently in stock</span>
          <span className="text-gray-400 text-sm ml-2">at {getDealerName(currentDealerId)}</span>
        </div>
      )}

      {daysOnLot !== null && (
        <div className="bg-gray-900 border border-gray-800 rounded-lg p-4 inline-block">
          <p className="text-gray-400 text-sm">Total Days on Lot</p>
          <p className="text-white text-2xl font-bold">{daysOnLot}</p>
        </div>
      )}

      <div className="bg-gray-900 border border-gray-800 rounded-lg p-4">
        <h2 className="text-white font-semibold mb-4">Dealer History</h2>
        <div className="space-y-2">
          {presenceList.map((p, i) => (
            <div key={i} className="flex items-center justify-between text-sm bg-gray-800 rounded px-3 py-2">
              <span className="text-white">
                {getDealerName(p.last_seen_dealer_id)}
                {p.current_status === "active" && (
                  <span className="text-green-400 text-xs ml-2">● in stock</span>
                )}
              </span>
              <span className="text-gray-400">
                {p.first_seen_date.slice(0, 10)} → {p.last_seen_date.slice(0, 10)}
              </span>
            </div>
          ))}
          {presenceList.length === 0 && <p className="text-gray-500 text-sm">No presence data</p>}
        </div>
      </div>

      <div className="bg-gray-900 border border-gray-800 rounded-lg p-4">
        <h2 className="text-white font-semibold mb-4">Event Timeline</h2>
        <div className="relative pl-4 border-l border-gray-700 space-y-4">
          {eventList.map((e) => {
            const colorClass =
              e.event_type === "added"
                ? "bg-green-500"
                : e.event_type === "removed"
                ? "bg-red-500"
                : "bg-yellow-500";
            return (
              <div key={e.id} className="relative">
                <div className={`absolute -left-5 w-3 h-3 rounded-full ${colorClass} mt-1`} />
                <div>
                  <p className="text-white text-sm font-medium capitalize">{e.event_type.replace("_", " ")}</p>
                  <p className="text-gray-400 text-xs">
                    {getDealerName(e.from_dealer_id)} · {e.event_date.slice(0, 10)}
                    {e.new_price != null ? ` · $${e.new_price.toLocaleString()}` : ""}
                  </p>
                </div>
              </div>
            );
          })}
          {eventList.length === 0 && <p className="text-gray-500 text-sm">No events</p>}
        </div>
      </div>
    </div>
  );
}
