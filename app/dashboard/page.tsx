import { createServerSupabase } from "@/lib/supabase-server";
import KPICard from "@/components/KPICard";
import type { Dealer } from "@/types";
import MarketCharts from "./MarketCharts";

export default async function DashboardPage() {
  const supabase = await createServerSupabase();

  const { data: dealers } = await supabase.from("dealers").select("*");
  const dealerList: Dealer[] = dealers ?? [];

  // Per-dealer: get latest snapshot date, then count for that date
  const byDealer = await Promise.all(
    dealerList.map(async (d) => {
      const { data: latestDate } = await supabase
        .from("inventory_snapshots")
        .select("snapshot_date")
        .eq("dealer_id", d.id)
        .order("snapshot_date", { ascending: false })
        .limit(1)
        .single();

      if (!latestDate) return { name: d.name, count: 0, sold: 0 };

      const { count } = await supabase
        .from("inventory_snapshots")
        .select("id", { count: "exact" })
        .eq("dealer_id", d.id)
        .eq("snapshot_date", latestDate.snapshot_date);

      return { name: d.name, count: count ?? 0, sold: 0 };
    })
  );

  const totalInventory = byDealer.reduce((sum, d) => sum + d.count, 0);

  // Avg price: per dealer from latest snapshot, exclude nulls
  let totalPriceSum = 0;
  let totalPriceCount = 0;
  await Promise.all(
    dealerList.map(async (d) => {
      const { data: latest } = await supabase
        .from("inventory_snapshots")
        .select("snapshot_date")
        .eq("dealer_id", d.id)
        .order("snapshot_date", { ascending: false })
        .limit(1)
        .single();
      if (!latest) return;
      const { data: snaps } = await supabase
        .from("inventory_snapshots")
        .select("list_price")
        .eq("dealer_id", d.id)
        .eq("snapshot_date", latest.snapshot_date)
        .not("list_price", "is", null);
      for (const s of snaps ?? []) {
        totalPriceSum += s.list_price ?? 0;
        totalPriceCount++;
      }
    })
  );
  const avgPrice = totalPriceCount > 0 ? Math.round(totalPriceSum / totalPriceCount) : 0;

  // Estimated units sold = inventory_events removed last 30 days
  const thirtyDaysAgo = new Date();
  thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);
  const { count: estimatedSold } = await supabase
    .from("inventory_events")
    .select("id", { count: "exact" })
    .eq("event_type", "removed")
    .gte("event_date", thirtyDaysAgo.toISOString().split("T")[0]);

  return (
    <div className="p-6 space-y-6">
      <h1 className="text-white text-xl font-bold">Market Overview</h1>
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <KPICard label="Total Market Inventory" value={totalInventory.toLocaleString()} trend="neutral" />
        <KPICard label="Avg List Price" value={`$${avgPrice.toLocaleString()}`} trend="neutral" />
        <KPICard label="Est. Units Sold (30d)" value={(estimatedSold ?? 0).toLocaleString()} trend="up" trendValue="Last 30 days" />
      </div>
      <MarketCharts byDealer={byDealer} dealers={dealerList} />
    </div>
  );
}
