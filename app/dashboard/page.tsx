import { createServerSupabase } from "@/lib/supabase-server";
import KPICard from "@/components/KPICard";
import type { Dealer } from "@/types";
import MarketCharts from "./MarketCharts";

export default async function DashboardPage() {
  const supabase = await createServerSupabase();

  // Fetch dealers (exclude Globul Enterprises — no data source available)
  const { data: dealers } = await supabase
    .from("dealers")
    .select("*")
    .neq("name", "Globul Enterprises");
  const dealerList: Dealer[] = dealers ?? [];

  // Get the most recent snapshot_date per dealer, then count inventory for that date
  const byDealer = await Promise.all(
    dealerList.map(async (d) => {
      // Find most recent date for this dealer
      const { data: latestDate } = await supabase
        .from("inventory_snapshots")
        .select("snapshot_date")
        .eq("dealer_id", d.id)
        .order("snapshot_date", { ascending: false })
        .limit(1)
        .single();

      if (!latestDate) return { name: d.name, count: 0, sold: 0 };

      // Count distinct vehicle_id for that date
      const { count } = await supabase
        .from("inventory_snapshots")
        .select("id", { count: "exact" })
        .eq("dealer_id", d.id)
        .eq("snapshot_date", latestDate.snapshot_date);

      return { name: d.name, count: count ?? 0, sold: 0 };
    })
  );

  const totalInventory = byDealer.reduce((sum, d) => sum + d.count, 0);

  // Avg list price — from most recent snapshots across all dealers
  const { data: priceData } = await supabase
    .from("inventory_snapshots")
    .select("list_price, snapshot_date")
    .order("snapshot_date", { ascending: false })
    .limit(1000);

  // Keep only latest snapshot per vehicle+dealer combo
  const seenKeys = new Set<string>();
  const latestPrices: number[] = [];
  for (const row of priceData ?? []) {
    // Use snapshot_date as a proxy — just take all from the most recent batch
    if (row.list_price) latestPrices.push(row.list_price);
    if (seenKeys.size === 0) seenKeys.add(row.snapshot_date);
    else if (!seenKeys.has(row.snapshot_date)) break; // stop when date changes
  }
  const avgPrice =
    latestPrices.length > 0
      ? Math.round(latestPrices.reduce((s, p) => s + p, 0) / latestPrices.length)
      : 0;

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
