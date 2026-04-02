import { createServerSupabase } from "@/lib/supabase-server";
import KPICard from "@/components/KPICard";
import RoleGuard from "@/components/RoleGuard";
import CompetitorCharts from "./CompetitorCharts";
import type { Dealer, InventorySnapshot, InventoryEvent } from "@/types";

const COMPETITOR_NAMES = ["Ariana", "Auto Vision", "Boktors", "Globul", "One Motors", "Platinum"];

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

  const [{ data: snapshots }, { data: recentEvents }] = await Promise.all([
    supabase
      .from("inventory_snapshots")
      .select("*")
      .in("dealer_id", dealerIds)
      .gte("snapshot_date", ninetyDaysAgo.toISOString())
      .order("snapshot_date", { ascending: true }),
    supabase
      .from("inventory_events")
      .select("*")
      .in("dealer_id", dealerIds)
      .eq("event_type", "added")
      .gte("event_date", sevenDaysAgo.toISOString())
      .order("event_date", { ascending: false }),
  ]);

  const snapshotList: InventorySnapshot[] = snapshots ?? [];
  const eventList: InventoryEvent[] = recentEvents ?? [];

  // Avg list price per competitor
  const kpis = dealers.map((d) => {
    const ds = snapshotList.filter((s) => s.dealer_id === d.id);
    const priced = ds.filter((s) => s.list_price != null);
    const avg = priced.length
      ? Math.round(priced.reduce((sum, s) => sum + (s.list_price ?? 0), 0) / priced.length)
      : 0;
    return { dealer: d, avg };
  });

  return (
    <div className="p-6 space-y-6">
      <h1 className="text-white text-xl font-bold">Competitor Intel</h1>
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        {kpis.map(({ dealer, avg }) => (
          <KPICard key={dealer.id} label={`${dealer.name} Avg Price`} value={`$${avg.toLocaleString()}`} trend="neutral" />
        ))}
      </div>
      <CompetitorCharts dealers={dealers} snapshots={snapshotList} />
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
                <td className="px-4 py-3 font-mono text-amber-400">VIN-{e.vehicle_id}</td>
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
