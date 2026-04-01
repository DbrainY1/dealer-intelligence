import { createServerSupabase } from "@/lib/supabase-server";
import KPICard from "@/components/KPICard";
import Link from "next/link";
import type { Dealer, DealerGroup, InventorySnapshot, InventoryEvent } from "@/types";

interface PageProps {
  params: { id: string };
}

export default async function GroupPage({ params }: PageProps) {
  const supabase = await createServerSupabase();

  const { data: group } = await supabase
    .from("dealer_groups")
    .select("*")
    .eq("id", params.id)
    .single<DealerGroup>();

  const { data: dealers } = await supabase
    .from("dealers")
    .select("*")
    .eq("group_id", params.id);

  const dealerList: Dealer[] = dealers ?? [];
  const dealerIds = dealerList.map((d) => d.id);

  const { data: snapshots } = await supabase
    .from("inventory_snapshots")
    .select("*")
    .in("dealer_id", dealerIds)
    .order("snapshot_date", { ascending: false });

  const snapshotList: InventorySnapshot[] = snapshots ?? [];

  const latestByVin = new Map<string, InventorySnapshot>();
  for (const s of snapshotList) {
    const key = `${s.vin}:${s.dealer_id}`;
    if (!latestByVin.has(key)) latestByVin.set(key, s);
  }
  const latest = Array.from(latestByVin.values());

  const thirtyDaysAgo = new Date();
  thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);

  const { data: events } = await supabase
    .from("inventory_events")
    .select("*")
    .in("dealer_id", dealerIds)
    .gte("event_date", thirtyDaysAgo.toISOString());

  const eventList: InventoryEvent[] = events ?? [];

  // Find VINs that appear at multiple dealers (potential transfers)
  const vinDealerMap = new Map<string, Set<string>>();
  for (const s of latest) {
    if (!vinDealerMap.has(s.vin)) vinDealerMap.set(s.vin, new Set());
    vinDealerMap.get(s.vin)!.add(s.dealer_id);
  }
  const transferVins = Array.from(vinDealerMap.entries())
    .filter(([, dealers]) => dealers.size > 1)
    .map(([vin]) => vin)
    .slice(0, 10);

  return (
    <div className="p-6 space-y-6">
      <h1 className="text-white text-xl font-bold">{group?.name ?? "Group"}</h1>
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        {dealerList.map((d) => {
          const dealerSnaps = latest.filter((s) => s.dealer_id === d.id && s.status === "active");
          const avgDays = dealerSnaps.length
            ? Math.round(dealerSnaps.reduce((sum, s) => sum + (s.days_on_lot ?? 0), 0) / dealerSnaps.length)
            : 0;
          const avgPrice = dealerSnaps.length
            ? Math.round(dealerSnaps.reduce((sum, s) => sum + (s.list_price ?? 0), 0) / dealerSnaps.length)
            : 0;
          const soldCount = eventList.filter((e) => e.dealer_id === d.id && e.event_type === "removed").length;
          return (
            <Link key={d.id} href={`/dashboard/dealer/${d.id}`} className="block">
              <div className="bg-gray-900 border border-gray-800 rounded-lg p-4 hover:border-blue-600 transition-colors">
                <h2 className="text-white font-semibold mb-3">{d.name}</h2>
                <div className="grid grid-cols-2 gap-2 text-sm">
                  <div>
                    <p className="text-gray-400">In Stock</p>
                    <p className="text-white font-bold">{dealerSnaps.length}</p>
                  </div>
                  <div>
                    <p className="text-gray-400">Avg Days</p>
                    <p className="text-white font-bold">{avgDays}</p>
                  </div>
                  <div>
                    <p className="text-gray-400">Avg Price</p>
                    <p className="text-white font-bold">${avgPrice.toLocaleString()}</p>
                  </div>
                  <div>
                    <p className="text-gray-400">Sold (30d)</p>
                    <p className="text-white font-bold">{soldCount}</p>
                  </div>
                </div>
              </div>
            </Link>
          );
        })}
      </div>

      {transferVins.length > 0 && (
        <div className="bg-gray-900 border border-gray-800 rounded-lg p-4">
          <h2 className="text-white font-semibold mb-3">Possible Transfers (VINs at Multiple Rooftops)</h2>
          <div className="flex flex-wrap gap-2">
            {transferVins.map((vin) => (
              <Link key={vin} href={`/dashboard/vin/${vin}`} className="font-mono text-xs bg-gray-800 text-blue-400 px-2 py-1 rounded hover:bg-gray-700">
                {vin}
              </Link>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
