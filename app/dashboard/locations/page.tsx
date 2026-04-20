export const dynamic = "force-dynamic";

import { createServerSupabase } from "@/lib/supabase-server";
import LocationsMap from "./LocationsMap";
import type { DealerMapData } from "./LocationsMap";

export default async function LocationsPage() {
  const supabase = await createServerSupabase();

  const { data: dealers } = await supabase.from("dealers").select("id, name");
  const dealerList = (dealers ?? []) as { id: number; name: string }[];
  const dealerIds = dealerList.map((d) => d.id);

  // Latest inventory snapshot per dealer
  const allSnapshots: { dealer_id: number; list_price: number | null; status: string | null }[] = [];
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
        .select("dealer_id, list_price, status")
        .eq("dealer_id", d.id)
        .eq("snapshot_date", (latest as { snapshot_date: string }).snapshot_date);
      if (snaps) allSnapshots.push(...(snaps as typeof allSnapshots));
    })
  );

  // MTD sold
  const monthStart = new Date();
  monthStart.setDate(1);
  const { data: monthlySales } = await supabase
    .from("monthly_sales")
    .select("dealer_id, units_sold")
    .eq("month_start", monthStart.toISOString().split("T")[0])
    .in("dealer_id", dealerIds);
  const soldByDealer = new Map(
    (monthlySales ?? []).map((r: { dealer_id: number; units_sold: number }) => [
      r.dealer_id,
      r.units_sold ?? 0,
    ])
  );

  // New listings last 7 days
  const sevenDaysAgo = new Date();
  sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);
  const { data: newListingEvents } = await supabase
    .from("inventory_events")
    .select("to_dealer_id")
    .eq("event_type", "added")
    .gte("event_date", sevenDaysAgo.toISOString().split("T")[0])
    .in("to_dealer_id", dealerIds);
  const newListingsByDealer = new Map<number, number>();
  for (const e of (newListingEvents ?? []) as { to_dealer_id: number | null }[]) {
    if (e.to_dealer_id != null) {
      newListingsByDealer.set(e.to_dealer_id, (newListingsByDealer.get(e.to_dealer_id) ?? 0) + 1);
    }
  }

  const dayOfMonth = new Date().getDate();
  const dealerMapData: DealerMapData[] = dealerList.map((d) => {
    const ds = allSnapshots.filter((s) => s.dealer_id === d.id && s.status === "active");
    const inStock = ds.length;
    const mtdSold = soldByDealer.get(d.id) ?? 0;
    const daysOfSupply = mtdSold > 0 ? Math.round((inStock * dayOfMonth) / mtdSold) : null;
    const validPrices = ds
      .filter((s) => s.list_price != null && s.list_price > 500)
      .map((s) => s.list_price as number);
    const avgListPrice =
      validPrices.length > 0
        ? Math.round(validPrices.reduce((a, b) => a + b, 0) / validPrices.length)
        : null;
    const newListings7d = newListingsByDealer.get(d.id) ?? 0;
    return { name: d.name, inStock, mtdSold, avgListPrice, daysOfSupply, newListings7d };
  });

  return (
    <div className="p-6 space-y-4">
      <div>
        <h1 className="text-white text-xl font-bold">Locations</h1>
        <p className="text-gray-400 text-sm mt-1">
          Track dealership positioning across the Las Vegas market.
        </p>
      </div>
      <LocationsMap dealerData={dealerMapData} />
    </div>
  );
}
