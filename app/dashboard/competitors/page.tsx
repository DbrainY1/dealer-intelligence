export const dynamic = "force-dynamic";

import { createServerSupabase } from "@/lib/supabase-server";
import RoleGuard from "@/components/RoleGuard";
import CompetitorCharts from "./CompetitorCharts";
import type { Dealer, InventorySnapshot, InventoryEvent } from "@/types";

const COMPETITOR_NAMES = ["Baja", "Newport", "Ariana", "Auto Vision", "Boktors", "Charlie", "Globul", "Hot Deals", "One Motors", "Platinum", "Queen", "Nellis", "RevEuro"];

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

  // Weekly adds and removes
  const { data: weeklyAdds } = await supabase
    .from("inventory_events")
    .select("*")
    .in("dealer_id", dealerIds)
    .eq("event_type", "added")
    .gte("event_date", sevenDaysAgo.toISOString().split("T")[0])
    .order("event_date", { ascending: false });

  const { data: weeklyRemovals } = await supabase
    .from("inventory_events")
    .select("dealer_id")
    .in("dealer_id", dealerIds)
    .eq("event_type", "removed")
    .gte("event_date", sevenDaysAgo.toISOString().split("T")[0]);

  const eventList: InventoryEvent[] = weeklyAdds ?? [];

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

    if (!latest) return { dealer: d, count: 0, avg: 0, sold: 0, added: 0, removed: 0 };

    const [{ count }, { data: snaps }] = await Promise.all([
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
    ]);

    const priced = snaps ?? [];
    const avg = priced.length ? Math.round(priced.reduce((s, r) => s + (r.list_price ?? 0), 0) / priced.length) : 0;
    const added = (weeklyAdds ?? []).filter((e) => e.dealer_id === d.id).length;
    const removed = (weeklyRemovals ?? []).filter((e) => e.dealer_id === d.id).length;

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
    <div className="p-6 space-y-6">
      <h1 className="text-white text-xl font-bold">Competitor Intel</h1>

      {/* Scorecards */}
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-3">
        {scorecards.map(({ dealer, count, avg, sold, added, removed }) => (
          <div key={dealer.id} className="bg-gray-900 border border-gray-700 rounded-lg overflow-hidden">
            {/* Dealer name — lighter header */}
            <div className="bg-gray-700 px-3 py-2">
              <p className="text-white font-bold text-sm truncate">{dealer.name}</p>
            </div>

            {/* Stats body */}
            <div className="p-3 space-y-2">
              {/* Inventory count + MTD Sold side by side */}
              <div className="flex justify-between items-end">
                <div>
                  <p className="text-2xl font-bold text-blue-400">{count.toLocaleString()}</p>
                  <p className="text-gray-500 text-xs">in stock</p>
                </div>
                <div className="text-right">
                  <p className="text-2xl font-bold text-green-400">{sold}</p>
                  <p className="text-gray-500 text-xs">MTD sold</p>
                </div>
              </div>

              {/* Weekly activity */}
              <div className="flex justify-between border-t border-gray-800 pt-2 text-xs">
                <div className="flex items-center gap-1">
                  <span className="text-green-300 font-semibold">↑ {added}</span>
                  <span className="text-gray-500">added</span>
                </div>
                <div className="flex items-center gap-1">
                  <span className="text-red-300 font-semibold">↓ {removed}</span>
                  <span className="text-gray-500">removed</span>
                </div>
              </div>
            </div>
          </div>
        ))}
      </div>

      {/* 90-day trend chart */}
      <CompetitorCharts dealers={dealers} snapshots={allSnapshots} />

      {/* New listings this week */}
      <div className="bg-gray-900 border border-gray-800 rounded-lg p-4">
        <h2 className="text-white font-semibold mb-4">New Listings (Last 7 Days)</h2>
        <table className="w-full text-sm text-left text-gray-300">
          <thead className="text-xs text-gray-400 uppercase bg-gray-800">
            <tr>
              <th className="px-4 py-3">VIN</th>
              <th className="px-4 py-3">Dealer</th>
              <th className="px-4 py-3">Date</th>
              <th className="px-4 py-3">Price</th>
            </tr>
          </thead>
          <tbody>
            {eventList.slice(0, 20).map((e) => (
              <tr key={e.id} className="border-b border-gray-800">
                <td className="px-4 py-3 font-mono text-amber-400">VID-{e.vehicle_id}</td>
                <td className="px-4 py-3">{dealers.find((d) => d.id === e.dealer_id)?.name ?? `Dealer ${e.dealer_id}`}</td>
                <td className="px-4 py-3">{e.event_date.slice(0, 10)}</td>
                <td className="px-4 py-3">{e.price_at_listing != null ? `$${e.price_at_listing.toLocaleString()}` : "—"}</td>
              </tr>
            ))}
            {eventList.length === 0 && (
              <tr>
                <td colSpan={4} className="px-4 py-6 text-center text-gray-500">No new listings</td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      <RoleGuard roles={["owner", "developer"]}>
        <div className="bg-gray-900 border border-amber-900/40 rounded-lg p-4">
          <h2 className="text-white font-semibold mb-2">Estimated Sales (Restricted)</h2>
          <p className="text-gray-400 text-sm">Visible to owners and developers only.</p>
        </div>
      </RoleGuard>
    </div>
  );
}
