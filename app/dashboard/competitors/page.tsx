export const dynamic = "force-dynamic";

import { createServerSupabase } from "@/lib/supabase-server";
import RoleGuard from "@/components/RoleGuard";
import CompetitorsPageClient from "./CompetitorsPageClient";
import { dedupeProjectedSold } from "@/lib/projected-sold";
import { pacificDaysAgoStr } from "@/lib/dates";
import { isCanonicalRow, cutoffLabel } from "@/lib/cutoff";
import type { Dealer, InventorySnapshot, InventoryEvent } from "@/types";

interface MonthlySalesRow {
  dealer_id: number;
  units_sold: number | null;
  computed_by: string | null;
  projection_cutoff: string | null;
}

export default async function CompetitorsPage() {
  const supabase = await createServerSupabase();

  // Roster = DB enrollment, same predicate as Locations: scrape_enabled TRUE
  // (scraper) or NULL (HomeNet feed); FALSE (intake/disabled) is excluded.
  // Identity is dealer_id throughout — no name-based roster selection.
  const { data: enrolledDealers } = await supabase
    .from("dealers")
    .select("id, name")
    .or("scrape_enabled.eq.true,scrape_enabled.is.null");
  // Only id + name are queried and used anywhere downstream (identity is
  // dealer_id; no consumer reads dealer_group_id), so we do not select an unused
  // column — cast the id/name rows to Dealer to satisfy existing prop types
  // (incl. the untouched VIN modal) without widening the query.
  const dealers = (enrolledDealers ?? []) as Dealer[];
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
    .eq("excluded_from_metrics", false)
    .gte("event_date", sevenDaysAgo.toISOString().split("T")[0])
    .order("event_date", { ascending: false });

  const eventList: InventoryEvent[] = weeklyEvents ?? [];

  // Estimated Sales / Daily Sold implements the V2 read-layer projected-sold rule
  // from DBRAIN_V2_CUTOVER_NOTES.md and matches the DBRAIN Daily Market Movement
  // email logic.
  // Confirmed Sold + Pending Sale, deduplicated by vehicle, sold preferred,
  // transfers excluded, from_dealer_id attribution.
  // MTD Sold continues to use monthly_sales / resolved_at and is unchanged.
  //
  // Same trailing Last-7-Days window as above, anchored to the Pacific calendar
  // date so this matches the DBRAIN email's date axis.
  const soldWindowStartStr = pacificDaysAgoStr(7);
  const SOLD_COLS = "id, vehicle_id, event_type, event_date, from_dealer_id, price_at_listing, last_seen_price";

  // Confirmed Sold: event_type='sold', attributed to the selling (from) dealer.
  const { data: soldRowsRaw } = await supabase
    .from("inventory_events")
    .select(SOLD_COLS)
    .in("from_dealer_id", dealerIds)
    .eq("event_type", "sold")
    .gte("event_date", soldWindowStartStr);
  const soldRows = (soldRowsRaw ?? []) as InventoryEvent[];

  // Pending Sale: event_type='pending_removal' that has not yet resolved.
  const { data: pendingRowsRaw } = await supabase
    .from("inventory_events")
    .select(SOLD_COLS)
    .in("from_dealer_id", dealerIds)
    .eq("event_type", "pending_removal")
    .is("resolved_at", null)
    .gte("event_date", soldWindowStartStr);
  const pendingRows = (pendingRowsRaw ?? []) as InventoryEvent[];

  // Transferred vehicles in the window are excluded from projected sold.
  const { data: transferredRowsRaw } = await supabase
    .from("inventory_events")
    .select("vehicle_id")
    .eq("event_type", "transferred")
    .gte("event_date", soldWindowStartStr);
  const transferredVehicleIds = new Set<number>(
    (transferredRowsRaw ?? []).map((r: { vehicle_id: number }) => r.vehicle_id).filter((v) => v != null)
  );

  // 1,000-row pagination canary: PostgREST caps responses at 1,000 rows. If any
  // of these hits the cap the projected-sold count is silently truncated.
  for (const [name, rows] of [
    ["sold", soldRows],
    ["pending_removal", pendingRows],
    ["transferred", transferredRowsRaw ?? []],
  ] as const) {
    if (rows.length === 1000) {
      console.warn(`[market-pulse] PAGINATION CANARY: ${name} query returned exactly 1000 rows — projected-sold count may be truncated.`);
    }
  }

  const estimatedSales = dedupeProjectedSold(soldRows, pendingRows, transferredVehicleIds);

  // Fetch vehicle data for events (year, make, model, vin, mileage)
  const vehicleIds = [...new Set([...eventList, ...estimatedSales].map(e => e.vehicle_id))];
  let vehicleMap = new Map<number, { year: number | null; make: string | null; model: string | null; mileage: number | null; vin: string | null }>();
  if (vehicleIds.length > 0) {
    // Batch fetch vehicles in chunks
    for (let i = 0; i < vehicleIds.length; i += 100) {
      const chunk = vehicleIds.slice(i, i + 100);
      const { data: vehicles } = await supabase
        .from("vehicles")
        .select("id, year, make, model, vin")
        .in("id", chunk);
      if (vehicles) {
        vehicles.forEach((v: any) => {
          vehicleMap.set(v.id, { year: v.year, make: v.make, model: v.model, mileage: null, vin: v.vin });
        });
      }
    }
    
    // Fetch mileage + price from snapshots in chunks
    for (let i = 0; i < vehicleIds.length; i += 100) {
      const chunk = vehicleIds.slice(i, i + 100);
      const { data: snapshots } = await supabase
        .from("inventory_snapshots")
        .select("vehicle_id, mileage, list_price")
        .in("vehicle_id", chunk)
        .order("snapshot_date", { ascending: false });
      
      if (snapshots && snapshots.length > 0) {
        const seen = new Set<number>();
        for (const snap of snapshots) {
          if (!seen.has(snap.vehicle_id)) {
            const existing = vehicleMap.get(snap.vehicle_id);
            if (existing) {
              vehicleMap.set(snap.vehicle_id, {
                ...existing,
                mileage: snap.mileage || null,
              });
              seen.add(snap.vehicle_id);
            }
          }
        }
      }
    }
  }

  // MTD sold per dealer (with canonical projection metadata)
  const { data: monthlySales } = await supabase
    .from("monthly_sales")
    .select("dealer_id, units_sold, computed_by, projection_cutoff")
    .eq("month_start", monthStart.toISOString().split("T")[0])
    .in("dealer_id", dealerIds);
  const soldByDealer = new Map((monthlySales ?? []).map((r: MonthlySalesRow) => [r.dealer_id, r.units_sold ?? 0]));
  // Canonical partial-month cutoff (shared across rows this month; NULL for
  // legacy). Derived from projection_cutoff — never hardcoded.
  const canonicalCutoff =
    (monthlySales ?? [])
      .map((r: MonthlySalesRow) => (isCanonicalRow(r.computed_by) ? r.projection_cutoff : null))
      .find((c): c is string => c != null) ?? null;
  const soldLabel = cutoffLabel(canonicalCutoff, "Sold since") ?? "MTD sold";

  // Per-dealer scorecard data: inventory count + avg price
  const scorecards = await Promise.all(dealers.map(async (d) => {
    const { data: latest } = await supabase
      .from("inventory_snapshots")
      .select("snapshot_date")
      .eq("dealer_id", d.id)
      .order("snapshot_date", { ascending: false })
      .limit(1)
      .single();

    if (!latest) return { dealer: d, count: 0, avg: 0, sold: soldByDealer.has(d.id) ? (soldByDealer.get(d.id) ?? 0) : null, added: null, removed: null };

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
      // MTD Sold source (monthly_sales) is unchanged. Distinguish a genuinely
      // absent monthly_sales row (null → "—") from a real numeric zero: HomeNet
      // feed dealers #1/#2/#3 have no monthly_sales row and must NOT show a fake 0.
      sold: soldByDealer.has(d.id) ? (soldByDealer.get(d.id) ?? 0) : null,
      added,
      removed,
    };
  }));

  return (
    <RoleGuard roles={['developer', 'dealer_principal', 'viewer']}>
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
        estimatedSales={estimatedSales}
        vehicleMap={Object.fromEntries(vehicleMap)}
        soldLabel={soldLabel}
      />
    </RoleGuard>
  );
}
