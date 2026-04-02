import { createServerSupabase } from "@/lib/supabase-server";
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

  const [{ data: events }, { data: presences }, { data: dealers }] = await Promise.all([
    vehicleId
      ? supabase.from("inventory_events").select("*").eq("vehicle_id", vehicleId).order("event_date", { ascending: true })
      : Promise.resolve({ data: [] }),
    vehicleId
      ? supabase.from("vin_presence").select("*").eq("vehicle_id", vehicleId)
      : Promise.resolve({ data: [] }),
    supabase.from("dealers").select("*"),
  ]);

  const eventList: InventoryEvent[] = events ?? [];
  const presenceList: VinPresenceRow[] = presences ?? [];
  const dealerList: Dealer[] = dealers ?? [];

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
        <p className="text-gray-400 text-sm font-mono">{vin}</p>
        <h1 className="text-white text-xl font-bold">
          {vehicle ? `${vehicle.year ?? ""} ${vehicle.make ?? ""} ${vehicle.model ?? ""}`.trim() : "VIN Detail"}
        </h1>
      </div>

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
              <span className="text-white">{getDealerName(p.last_seen_dealer_id)}</span>
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
