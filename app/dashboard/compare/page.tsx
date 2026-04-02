import { createServerSupabase } from "@/lib/supabase-server";
import CompareClient from "./CompareClient";
import type { Dealer, InventorySnapshot } from "@/types";

export default async function ComparePage() {
  const supabase = await createServerSupabase();

  const [{ data: dealers }, { data: snapshots }] = await Promise.all([
    supabase.from("dealers").select("*").neq("name", "Globul Enterprises"),
    supabase
      .from("inventory_snapshots")
      .select("*")
      .order("snapshot_date", { ascending: true }),
  ]);

  return (
    <CompareClient
      dealers={(dealers ?? []) as Dealer[]}
      snapshots={(snapshots ?? []) as InventorySnapshot[]}
    />
  );
}
