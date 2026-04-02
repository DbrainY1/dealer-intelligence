import { createServerSupabase } from "@/lib/supabase-server";
import CompareClient from "./CompareClient";
import type { Dealer, InventorySnapshot } from "@/types";

export default async function ComparePage() {
  const supabase = await createServerSupabase();

  const { data: dealers } = await supabase.from("dealers").select("*");
  const dealerList: Dealer[] = dealers ?? [];

  // For each dealer, get latest snapshot date then fetch all snapshots for that date
  // This avoids the 1000-row default limit cutting off dealers
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

  // Also fetch last 30 days trend data per dealer (capped at 100 per dealer)
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
      snapshots={allSnapshots}
      trendSnapshots={trendSnapshots}
    />
  );
}
