import { createServerSupabase } from "@/lib/supabase-server";
import KPICard from "@/components/KPICard";
import type { Dealer, InventorySnapshot } from "@/types";
import MarketCharts from "./MarketCharts";

export default async function DashboardPage() {
  const supabase = await createServerSupabase();

  const { data: dealers } = await supabase.from("dealers").select("*");
  const { data: snapshots } = await supabase
    .from("inventory_snapshots")
    .select("*")
    .order("snapshot_date", { ascending: false });

  const dealerList: Dealer[] = dealers ?? [];
  const snapshotList: InventorySnapshot[] = snapshots ?? [];

  // Get latest snapshot per VIN
  const latestByVin = new Map<string, InventorySnapshot>();
  for (const s of snapshotList) {
    if (!latestByVin.has(s.vin)) latestByVin.set(s.vin, s);
  }
  const latest = Array.from(latestByVin.values());

  const totalInventory = latest.filter((s) => s.status === "active").length;
  const avgPrice =
    latest.length > 0
      ? Math.round(
          latest.reduce((sum, s) => sum + (s.list_price ?? 0), 0) / latest.length
        )
      : 0;

  // Estimated units sold = removed in last 30 days
  const thirtyDaysAgo = new Date();
  thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);
  const { data: removedEvents } = await supabase
    .from("inventory_events")
    .select("*")
    .eq("event_type", "removed")
    .gte("event_date", thirtyDaysAgo.toISOString());
  const estimatedSold = removedEvents?.length ?? 0;

  // Inventory by dealer
  const byDealer = dealerList.map((d) => ({
    name: d.name,
    count: latest.filter((s) => s.dealer_id === d.id && s.status === "active").length,
    sold: removedEvents?.filter((e: { dealer_id: string }) => e.dealer_id === d.id).length ?? 0,
  }));

  return (
    <div className="p-6 space-y-6">
      <h1 className="text-white text-xl font-bold">Market Overview</h1>
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <KPICard label="Total Market Inventory" value={totalInventory.toLocaleString()} trend="neutral" />
        <KPICard label="Avg List Price" value={`$${avgPrice.toLocaleString()}`} trend="neutral" />
        <KPICard label="Est. Units Sold (30d)" value={estimatedSold.toLocaleString()} trend="up" trendValue="Last 30 days" />
      </div>
      <MarketCharts byDealer={byDealer} dealers={dealerList} />
    </div>
  );
}
