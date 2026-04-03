export const dynamic = "force-dynamic";

import { createServerSupabase } from "@/lib/supabase-server";
import KPICard from "@/components/KPICard";
import type { Dealer } from "@/types";
import MarketCharts from "./MarketCharts";

export default async function DashboardPage() {
  const supabase = await createServerSupabase();

  const { data: dealers } = await supabase.from("dealers").select("*");
  const dealerList: Dealer[] = dealers ?? [];

  // Monthly sold counts from monthly_sales table
  const monthStart = new Date();
  monthStart.setDate(1);
  const { data: monthlySales } = await supabase
    .from("monthly_sales")
    .select("dealer_id, units_sold")
    .eq("month_start", monthStart.toISOString().split("T")[0]);
  const soldByDealer = new Map((monthlySales ?? []).map((r: { dealer_id: number; units_sold: number }) => [r.dealer_id, r.units_sold ?? 0]));

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

      if (!latestDate) return { name: d.name, count: 0, sold: soldByDealer.get(d.id) ?? 0 };

      const { count } = await supabase
        .from("inventory_snapshots")
        .select("id", { count: "exact" })
        .eq("dealer_id", d.id)
        .eq("snapshot_date", latestDate.snapshot_date);

      return { name: d.name, count: count ?? 0, sold: soldByDealer.get(d.id) ?? 0 };
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

  // Total units sold this month (sum across all dealers)
  const estimatedSold = Array.from(soldByDealer.values()).reduce((sum, v) => sum + v, 0);

  return (
    <div className="p-6 space-y-6">
      <h1 className="text-white text-xl font-bold">Market Overview — {new Date().toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric", timeZone: "America/Los_Angeles" })}</h1>
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <KPICard label="Total Market Inventory" value={totalInventory.toLocaleString()} trend="neutral" />
        <KPICard label="Avg List Price" value={`$${avgPrice.toLocaleString()}`} trend="neutral" />
        <KPICard label="Units Sold (This Month)" value={estimatedSold.toLocaleString()} trend="up" trendValue="Current month" />
      </div>
      <MarketCharts byDealer={byDealer} dealers={dealerList} />
    </div>
  );
}
