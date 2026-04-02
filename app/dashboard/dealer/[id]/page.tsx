import { createServerSupabase } from "@/lib/supabase-server";
import InventoryTable from "@/components/InventoryTable";
import TrendChart from "@/components/TrendChart";
import type { Dealer, InventorySnapshot, Vehicle, InventoryEvent } from "@/types";

interface PageProps {
  params: { id: string };
}

export default async function DealerPage({ params }: PageProps) {
  const supabase = await createServerSupabase();

  const { data: dealer } = await supabase
    .from("dealers")
    .select("*")
    .eq("id", params.id)
    .single<Dealer>();

  const { data: snapshots } = await supabase
    .from("inventory_snapshots")
    .select("*")
    .eq("dealer_id", params.id)
    .order("snapshot_date", { ascending: false });

  const snapshotList: InventorySnapshot[] = snapshots ?? [];

  // Latest snapshot per vehicle_id
  const latestByVehicle = new Map<number, InventorySnapshot>();
  for (const s of snapshotList) {
    if (!latestByVehicle.has(s.vehicle_id)) latestByVehicle.set(s.vehicle_id, s);
  }
  const latest = Array.from(latestByVehicle.values()).filter((s) => s.status === "active");

  const vehicleIds = latest.map((s) => s.vehicle_id);
  const { data: vehicles } = vehicleIds.length
    ? await supabase.from("vehicles").select("*").in("id", vehicleIds)
    : { data: [] };
  const vehicleList: Vehicle[] = vehicles ?? [];

  const rows = latest.map((s) => ({
    snapshot: s,
    vehicle: vehicleList.find((v) => v.id === s.vehicle_id),
  }));

  // Inventory trend last 30 days
  const thirtyDaysAgo = new Date();
  thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);
  const trendMap = new Map<string, number>();
  for (const s of snapshotList) {
    if (new Date(s.snapshot_date) >= thirtyDaysAgo) {
      const date = s.snapshot_date.slice(0, 10);
      if (!trendMap.has(date)) trendMap.set(date, 0);
      if (s.status === "active") trendMap.set(date, (trendMap.get(date) ?? 0) + 1);
    }
  }
  const trendData = Array.from(trendMap.entries())
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([date, value]) => ({ date, value }));

  const sevenDaysAgo = new Date();
  sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);
  const { data: recentEvents } = await supabase
    .from("inventory_events")
    .select("*")
    .eq("dealer_id", params.id)
    .gte("event_date", sevenDaysAgo.toISOString())
    .order("event_date", { ascending: false });

  const eventList: InventoryEvent[] = recentEvents ?? [];
  const recentAdded = eventList.filter((e) => e.event_type === "added");
  const recentRemoved = eventList.filter((e) => e.event_type === "removed");

  return (
    <div className="p-6 space-y-6">
      <h1 className="text-white text-xl font-bold">{dealer?.name ?? "Dealer"}</h1>
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <TrendChart data={trendData} label="Inventory Count (Last 30 Days)" color="#3b82f6" />
        <div className="grid grid-cols-2 gap-4">
          <div className="bg-gray-900 border border-gray-800 rounded-lg p-4">
            <p className="text-gray-400 text-sm">Recent Additions (7d)</p>
            <p className="text-white text-2xl font-bold">{recentAdded.length}</p>
          </div>
          <div className="bg-gray-900 border border-gray-800 rounded-lg p-4">
            <p className="text-gray-400 text-sm">Recent Removals (7d)</p>
            <p className="text-white text-2xl font-bold">{recentRemoved.length}</p>
          </div>
        </div>
      </div>
      <div className="bg-gray-900 border border-gray-800 rounded-lg p-4">
        <h2 className="text-white font-semibold mb-4">Current Inventory</h2>
        <InventoryTable rows={rows} />
      </div>
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <div className="bg-gray-900 border border-gray-800 rounded-lg p-4">
          <h2 className="text-white font-semibold mb-3">Recent Additions</h2>
          <div className="space-y-2">
            {recentAdded.slice(0, 8).map((e) => (
              <div key={e.id} className="flex justify-between text-sm">
                <span className="font-mono text-blue-400">VID-{e.vehicle_id}</span>
                <span className="text-gray-400">{e.event_date.slice(0, 10)}</span>
              </div>
            ))}
            {recentAdded.length === 0 && <p className="text-gray-500 text-sm">None</p>}
          </div>
        </div>
        <div className="bg-gray-900 border border-gray-800 rounded-lg p-4">
          <h2 className="text-white font-semibold mb-3">Recent Removals</h2>
          <div className="space-y-2">
            {recentRemoved.slice(0, 8).map((e) => (
              <div key={e.id} className="flex justify-between text-sm">
                <span className="font-mono text-blue-400">VID-{e.vehicle_id}</span>
                <span className="text-gray-400">{e.event_date.slice(0, 10)}</span>
              </div>
            ))}
            {recentRemoved.length === 0 && <p className="text-gray-500 text-sm">None</p>}
          </div>
        </div>
      </div>
    </div>
  );
}
