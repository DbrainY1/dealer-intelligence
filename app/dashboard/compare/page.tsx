export const dynamic = "force-dynamic";

import { createServerSupabase } from "@/lib/supabase-server";
import CompareClient from "./CompareClient";
import type { Dealer, InventorySnapshot } from "@/types";
import type { DealerStat } from "./CompareClient";

export default async function ComparePage() {
  const supabase = await createServerSupabase();

  const { data: dealers } = await supabase.from("dealers").select("*");
  const dealerList: Dealer[] = dealers ?? [];
  const dealerIds = dealerList.map((d) => d.id);

  // For each dealer, get latest snapshot date then fetch all snapshots for that date
  const allSnapshots: InventorySnapshot[] = [];

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
        .select("*")
        .eq("dealer_id", d.id)
        .eq("snapshot_date", latest.snapshot_date);

      if (snaps) allSnapshots.push(...(snaps as InventorySnapshot[]));
    })
  );

  // Fetch vehicle years for avg year calculation
  const vehicleIds = [...new Set(allSnapshots.map((s) => s.vehicle_id))];
  const { data: vehicleData } = vehicleIds.length
    ? await supabase.from("vehicles").select("id, year").in("id", vehicleIds)
    : { data: [] };
  const vehicleYearMap = new Map(
    (vehicleData ?? []).map((v: { id: number; year: number | null }) => [v.id, v.year])
  );

  // Fetch MTD sold per dealer
  const monthStart = new Date();
  monthStart.setDate(1);
  const { data: monthlySales } = await supabase
    .from("monthly_sales")
    .select("dealer_id, units_sold")
    .eq("month_start", monthStart.toISOString().split("T")[0])
    .in("dealer_id", dealerIds);
  const soldByDealer = new Map(
    (monthlySales ?? []).map((r: { dealer_id: number; units_sold: number }) => [r.dealer_id, r.units_sold ?? 0])
  );

  // Pre-compute all 8 metrics per dealer
  const dealerStats: DealerStat[] = dealerList.map((d) => {
    const ds = allSnapshots.filter((s) => s.dealer_id === d.id && s.status === "active");

    const inStock = ds.length;
    const mtdSold = soldByDealer.get(d.id) ?? 0;
    const sellThrough = inStock > 0 ? (mtdSold / inStock) * 100 : 0;

    const validPrices = ds
      .filter((s) => s.list_price != null && s.list_price > 0)
      .map((s) => s.list_price as number);
    const avgListPrice = validPrices.length > 0
      ? Math.round(validPrices.reduce((a, b) => a + b, 0) / validPrices.length)
      : null;
    const totalValue = validPrices.reduce((a, b) => a + b, 0);

    const validMiles = ds
      .filter((s) => s.mileage != null && s.mileage > 0)
      .map((s) => s.mileage as number);
    const avgMiles = validMiles.length > 0
      ? Math.round(validMiles.reduce((a, b) => a + b, 0) / validMiles.length)
      : null;

    const validYears = ds
      .map((s) => vehicleYearMap.get(s.vehicle_id))
      .filter((y): y is number => y != null && y > 0);
    const avgYear = validYears.length > 0
      ? Math.round(validYears.reduce((a, b) => a + b, 0) / validYears.length)
      : null;

    return { id: d.id, name: d.name, inStock, mtdSold, sellThrough, avgYear, avgMiles, avgListPrice, totalValue };
  });

  // Fetch last 30 days trend data per dealer for the chart
  const thirtyDaysAgo = new Date();
  thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);
  const trendSnapshots: InventorySnapshot[] = [];

  await Promise.all(
    dealerList.map(async (d) => {
      const { data: trend } = await supabase
        .from("inventory_snapshots")
        .select("dealer_id, snapshot_date, vehicle_id, status")
        .eq("dealer_id", d.id)
        .gte("snapshot_date", thirtyDaysAgo.toISOString().split("T")[0])
        .order("snapshot_date", { ascending: true });

      if (trend) trendSnapshots.push(...(trend as InventorySnapshot[]));
    })
  );

  return (
    <CompareClient
      dealers={dealerList}
      dealerStats={dealerStats}
      trendSnapshots={trendSnapshots}
    />
  );
}
