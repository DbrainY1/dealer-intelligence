export const dynamic = "force-dynamic";

import { createServerSupabase } from "@/lib/supabase-server";
import RoleGuard from "@/components/RoleGuard";
import CompetitorsPageClient from "./CompetitorsPageClient";
import type { Dealer, InventorySnapshot, InventoryEvent } from "@/types";

const COMPETITOR_NAMES = ["Baja", "Newport", "Ariana", "Auto Vision", "Boktors", "Charlie", "Emporio", "Globul", "Hot Deals", "One Motors", "Platinum", "Queen", "Nellis", "RevEuro"];

export default async function CompetitorsPage() {
  const supabase = await createServerSupabase();

  const { data: allDealers } = await supabase.from("dealers").select("*");
  const dealers: Dealer[] = (allDealers ?? []).filter((d: Dealer) =>
    COMPETITOR_NAMES.some((n) => d.name.toLowerCase().includes(n.toLowerCase()))
  );
  const dealerIds = dealers.map((d) => d.id);

  const ninetyDaysAgo = new Date();
  ninetyDaysAgo.setDate(ninetyDaysAgo.getDate() - 90);
  const sevenDaysAgo = new Date();
  sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);
  const yesterday = new Date();
  yesterday.setDate(yesterday.getDate() - 1);
  const yesterdayStr = yesterday.toISOString().split("T")[0];
  const monthStart = new Date();
  monthStart.setDate(1);

  // 90-day snapshots for trend chart
  const allSnapshots: InventorySnapshot[] = [];
  await Promise.all(
    dealers.map(async (d) => {
      const { data } = await supabase
        .from("inventory_snapshots")
        .select("*")
        .eq("dealer_id", d.id)
        .gte("snapshot_date", ninetyDaysAgo.toISOString().split("T")[0])
        .order("snapshot_date", { ascending: true });
      if (data) allSnapshots.push(...(data as InventorySnapshot[]));
    })
  );

  // Weekly adds + removals (for New Listings + Estimated Sales tables)
  const { data: weeklyEvents } = await supabase
    .from("inventory_events")
    .select("*")
    .in("to_dealer_id", dealerIds)
    .in("event_type", ["added", "removed"])
    .gte("event_date", sevenDaysAgo.toISOString().split("T")[0])
    .order("event_date", { ascending: false });

  const eventList: InventoryEvent[] = weeklyEvents ?? [];

  // Fetch vehicle data for events (year, make, model, mileage, vin)
  const vehicleIds = [...new Set(eventList.map(e => e.vehicle_id))];
  let vehicleMap = new Map<number, { year: number | null; make: string | null; model: string | null; mileage: number | null; vin: string | null }>();
  if (vehicleIds.length > 0) {
    const { data: vehicles } = await supabase
      .from("vehicles")
      .select("id, year, make, model, mileage, vin")
      .in("id", vehicleIds);
    if (vehicles) {
      vehicles.forEach((v: any) => {
        vehicleMap.set(v.id, { year: v.year, make: v.make, model: v.model, mileage: v.mileage, vin: v.vin });
      });
    }
  }

  // MTD sold per dealer
  const { data: monthlySales } = await supabase
    .from("monthly_sales")
    .select("dealer_id, units_sold")
    .eq("month_start", monthStart.toISOString().split("T")[0])
    .in("dealer_id", dealerIds);
  const soldByDealer = new Map((monthlySales ?? []).map((r: { dealer_id: number; units_sold: number }) => [r.dealer_id, r.units_sold ?? 0]));

  // Per-dealer scorecard data: inventory count + avg price
  const scorecards = await Promise.all(dealers.map(async (d) => {
    const { data: latest } = await supabase
      .from("inventory_snapshots")
      .select("snapshot_date")
      .eq("dealer_id", d.id)
      .order("snapshot_date", { ascending: false })
      .limit(1)
      .single();

    if (!latest) return { dealer: d, count: 0, avg: 0, sold: 0, added: null, removed: null };

    // Get the most recent snapshot date strictly before today's
    const { data: priorDateData } = await supabase
      .from("inventory_snapshots")
      .select("snapshot_date")
      .eq("dealer_id", d.id)
      .lt("snapshot_date", latest.snapshot_date)
      .order("snapshot_date", { ascending: false })
      .limit(1)
      .single();

    const [{ count }, { data: snaps }, { data: todayVids }, { data: priorVids }] = await Promise.all([
      supabase
        .from("inventory_snapshots")
        .select("id", { count: "exact" })
        .eq("dealer_id", d.id)
        .eq("snapshot_date", latest.snapshot_date),
      supabase
        .from("inventory_snapshots")
        .select("list_price")
        .eq("dealer_id", d.id)
        .eq("snapshot_date", latest.snapshot_date)
        .not("list_price", "is", null),
      supabase
        .from("inventory_snapshots")
        .select("vehicle_id")
        .eq("dealer_id", d.id)
        .eq("snapshot_date", latest.snapshot_date),
      priorDateData
        ? supabase
            .from("inventory_snapshots")
            .select("vehicle_id")
            .eq("dealer_id", d.id)
            .eq("snapshot_date", priorDateData.snapshot_date)
        : Promise.resolve({ data: null }),
    ]);

    const priced = snaps ?? [];
    const avg = priced.length ? Math.round(priced.reduce((s, r) => s + (r.list_price ?? 0), 0) / priced.length) : 0;

    let added: number | null = null;
    let removed: number | null = null;
    if (priorDateData && priorVids) {
      const todaySet = new Set((todayVids ?? []).map((r) => r.vehicle_id));
      const priorSet = new Set(priorVids.map((r: { vehicle_id: number }) => r.vehicle_id));
      added = [...todaySet].filter((id) => !priorSet.has(id)).length;
      removed = [...priorSet].filter((id) => !todaySet.has(id)).length;
    }

    return {
      dealer: d,
      count: count ?? 0,
      avg,
      sold: soldByDealer.get(d.id) ?? 0,
      added,
      removed,
    };
  }));

  return (
    <CompetitorsPageClient
      scorecards={scorecards.map(({ dealer, count, sold, added, removed }) => ({
        id: dealer.id,
        name: dealer.name,
        count,
        sold,
        added,
        removed,
      }))}
      dealers={dealers}
      snapshots={allSnapshots}
      eventList={eventList}
      vehicleMap={Object.fromEntries(vehicleMap)}
    />
  );
}
