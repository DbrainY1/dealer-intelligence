import { createServerSupabase } from "@/lib/supabase-server";
import KPICard from "@/components/KPICard";
import RoleGuard from "@/components/RoleGuard";
import CompetitorCharts from "./CompetitorCharts";
import type { Dealer, InventorySnapshot, InventoryEvent } from "@/types";

const COMPETITOR_NAMES = ["Ariana", "Auto Vision", "Boktors", "Charlie", "Globul", "One Motors", "Platinum", "Queen", "Nellis"];

export default async function CompetitorsPage() {
  const supabase = await createServerSupabase();

  const { data: allDealers } = await supabase.from("dealers").select("*");
  const dealers: Dealer[] = (allDealers ?? []).filter((d: Dealer) =>
    COMPETITOR_NAMES.some((n) => d.name.toLowerCase().includes(n.toLowerCase()))
  );

  const ninetyDaysAgo = new Date();
  ninetyDaysAgo.setDate(ninetyDaysAgo.getDate() - 90);
  const sevenDaysAgo = new Date();
  sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);

  // Query each dealer separately to avoid 1000-row Supabase limit
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

  const dealerIds = dealers.map((d) => d.id);
  const { data: recentEvents } = await supabase
    .from("inventory_events")
    .select("*")
    .in("dealer_id", dealerIds)
    .eq("event_type", "added")
    .gte("event_date", sevenDaysAgo.toISOString().split("T")[0])
    .order("event_date", { ascending: false });

  const eventList: InventoryEvent[] = recentEvents ?? [];

  // Avg list price per competitor — latest snapshot date only, exclude nulls
  const kpis = await Promise.all(dealers.map(async (d) => {
    const { data: latest } = await supabase
      .from("inventory_snapshots")
      .select("snapshot_date")
      .eq("dealer_id", d.id)
      .order("snapshot_date", { ascending: false })
      .limit(1)
      .single();

    if (!latest) return { dealer: d, avg: 0 };

    const { data: snaps } = await supabase
      .from("inventory_snapshots")
      .select("list_price")
      .eq("dealer_id", d.id)
      .eq("snapshot_date", latest.snapshot_date)
      .not("list_price", "is", null);

    const priced = snaps ?? [];
    const total = Math.round(priced.reduce((sum, s) => sum + (s.list_price ?? 0), 0));
    const avg = priced.length ? Math.round(total / priced.length) : 0;
    return { dealer: d, avg, total };
  }));

  return (
    <div className="p-6 space-y-6">
      <h1 className="text-white text-xl font-bold">Competitor Intel</h1>
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        {kpis.map(({ dealer, avg, total }) => (
          <div key={dealer.id} className="bg-gray-900 border border-gray-800 rounded-lg p-4">
            <p className="text-white font-bold text-lg mb-2">{dealer.name}</p>
            <p className="text-gray-400 text-xs">Total: {(total ?? 0) > 0 ? `$${(total ?? 0).toLocaleString()}` : "—"}</p>
            <p className="text-gray-400 text-xs mt-1">Avg: {avg > 0 ? `$${avg.toLocaleString()}` : "—"}</p>
          </div>
        ))}
      </div>
      <CompetitorCharts dealers={dealers} snapshots={allSnapshots} />
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
