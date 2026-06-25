export const dynamic = "force-dynamic";

import { createServerSupabase } from "@/lib/supabase-server";
import RoleGuard from "@/components/RoleGuard";
import LocationsMap from "./LocationsMap";
import type { DealerMapData } from "./LocationsMap";

export default async function LocationsPage() {
  const supabase = await createServerSupabase();

  // DB-driven marker source. Visibility: include scrape_enabled TRUE and NULL
  // (HomeNet dealers #1/#2/#3 are NULL and must stay visible), exclude FALSE
  // (intake dealers like #16 Las Vegas Auto Sports, #30 Zara, #31 United
  // Nissan). `.neq(false)` would drop NULL rows — do not use it.
  type DealerRow = {
    id: number;
    name: string;
    latitude: number | string | null;
    longitude: number | string | null;
    dealer_group_id: number | null;
    address: string | null;
    website_url: string | null;
  };
  const { data: dealers } = await supabase
    .from("dealers")
    .select("id, name, latitude, longitude, dealer_group_id, address, website_url")
    .or("scrape_enabled.eq.true,scrape_enabled.is.null");

  // Skip rows with missing / non-finite coordinates so the map never renders a
  // pin at (NaN, NaN) or crashes. (Supabase may return numeric columns as
  // strings, so coerce before the finiteness check.)
  const visibleDealers = (dealers ?? []) as DealerRow[];
  const dealerList = visibleDealers.filter((d) => {
    const lat = Number(d.latitude);
    const lng = Number(d.longitude);
    return d.latitude != null && d.longitude != null && Number.isFinite(lat) && Number.isFinite(lng);
  });
  const skippedNoCoords = visibleDealers.length - dealerList.length;
  if (skippedNoCoords > 0) {
    console.warn(
      `[locations] skipped ${skippedNoCoords} visible dealer(s) with missing/invalid coordinates`
    );
  }
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
    .eq("excluded_from_metrics", false)
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
    // Metrics are keyed by d.id above; coordinates/group/identity come from the
    // same dealer row — so the client joins metrics ↔ pins by id (no name join).
    return {
      id: d.id,
      name: d.name,
      latitude: Number(d.latitude),
      longitude: Number(d.longitude),
      dealerGroupId: d.dealer_group_id,
      address: d.address,
      website: d.website_url,
      inStock,
      mtdSold,
      avgListPrice,
      daysOfSupply,
      newListings7d,
    };
  });

  return (
    <RoleGuard roles={['developer', 'dealer_principal', 'viewer']}>
      <div className="p-6 space-y-4">
        <div>
          <h1 className="text-white text-xl font-bold">Locations</h1>
          <p className="text-gray-400 text-sm mt-1">
            Track dealership positioning across the Las Vegas market.
          </p>
        </div>
        <LocationsMap dealerData={dealerMapData} />
      </div>
    </RoleGuard>
  );
}
