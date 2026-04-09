export const dynamic = "force-dynamic";

import { createClient } from "@supabase/supabase-js";
import InventoryTable from "@/components/InventoryTable";
import TrendChart from "@/components/TrendChart";
import VehicleEventList from "@/components/VehicleEventList";
import type { Dealer, InventorySnapshot, Vehicle, InventoryEvent } from "@/types";

interface PageProps {
  params: Promise<{ id: string }>;
}

function fmt$(n: number) {
  return n > 0 ? `$${Math.round(n).toLocaleString()}` : "—";
}
function fmtN(n: number) {
  return n > 0 ? n.toLocaleString() : "0";
}

function SummaryRow({ label, units, pace, avg, total }: { label: string; units: number; pace: number; avg: number; total: number }) {
  return (
    <div className="flex flex-wrap gap-6 items-center">
      <span className="text-gray-400 text-xs w-10 shrink-0">{label}</span>
      <div className="text-center">
        <p className="text-white font-bold text-base">{fmtN(units)}</p>
        <p className="text-gray-500 text-xs">Sold</p>
      </div>
      <div className="text-center">
        <p className="text-white font-bold text-base">{fmtN(pace)}</p>
        <p className="text-gray-500 text-xs">Pace</p>
      </div>
      <div className="text-center">
        <p className="text-white font-bold text-base">{fmt$(avg)}</p>
        <p className="text-gray-500 text-xs">Avg Price</p>
      </div>
      <div className="text-center">
        <p className="text-white font-bold text-base">{fmt$(total)}</p>
        <p className="text-gray-500 text-xs">Total Revenue</p>
      </div>
    </div>
  );
}

export default async function DealerPage({ params }: PageProps) {
  const { id: dealerId } = await params;
  const db = createClient(
    "https://jrgavepbhlrltfadeuke.supabase.co",
    "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImpyZ2F2ZXBiaGxybHRmYWRldWtlIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzQ5Njg5NDgsImV4cCI6MjA5MDU0NDk0OH0.It2KkRiTmtZJfPKSEBAvLmsA8aM3WgWhtGUd2smS2nk"
  );

  const { data: dealer } = await db
    .from("dealers")
    .select("*")
    .eq("id", dealerId)
    .single<Dealer>();

  // ── MTD / YTD dates ──────────────────────────────────────────────
  const now = new Date();
  const dayOfMonth = now.getDate();
  const daysInMonth = new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate();
  const dayOfYear = Math.ceil((now.getTime() - new Date(now.getFullYear(), 0, 0).getTime()) / 86400000);
  const daysInYear = ((now.getFullYear() % 4 === 0 && now.getFullYear() % 100 !== 0) || now.getFullYear() % 400 === 0) ? 366 : 365;

  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1).toISOString().split("T")[0];
  const yearStart = `${now.getFullYear()}-01-01`;
  const today = now.toISOString().split("T")[0];

  // ── Sold events (removal detector) ───────────────────────────────
  const { data: soldMTD } = await db
    .from("inventory_events")
    .select("vehicle_id, event_date, last_seen_price")
    .eq("from_dealer_id", dealerId)
    .eq("event_type", "sold")
    .gte("event_date", monthStart)
    .order("event_date", { ascending: false });

  const { data: soldYTD } = await db
    .from("inventory_events")
    .select("vehicle_id, event_date, last_seen_price")
    .eq("from_dealer_id", dealerId)
    .eq("event_type", "sold")
    .gte("event_date", yearStart)
    .order("event_date", { ascending: false });

  const mtdUnits = soldMTD?.length ?? 0;
  const ytdUnits = soldYTD?.length ?? 0;

  const mtdRevenue = (soldMTD ?? []).reduce((s, e) => s + (e.last_seen_price ?? 0), 0);
  const ytdRevenue = (soldYTD ?? []).reduce((s, e) => s + (e.last_seen_price ?? 0), 0);
  const mtdAvg = mtdUnits > 0 ? mtdRevenue / mtdUnits : 0;
  const ytdAvg = ytdUnits > 0 ? ytdRevenue / ytdUnits : 0;

  // Pace projections
  const mtdDailyRate = dayOfMonth > 0 ? mtdUnits / dayOfMonth : 0;
  const mtdPace = Math.round(mtdDailyRate * daysInMonth);
  const ytdDailyRate = dayOfYear > 0 ? ytdUnits / dayOfYear : 0;
  const ytdPace = Math.round(ytdDailyRate * daysInYear);

  // ── Added events ──────────────────────────────────────────────────
  const { data: addedMTD } = await db
    .from("inventory_events")
    .select("vehicle_id, event_date, price_at_listing")
    .eq("from_dealer_id", dealerId)
    .eq("event_type", "added")
    .gte("event_date", monthStart)
    .order("event_date", { ascending: false });

  // ── Current inventory ─────────────────────────────────────────────
  const { data: snapshots } = await db
    .from("inventory_snapshots")
    .select("*")
    .eq("dealer_id", dealerId)
    .order("snapshot_date", { ascending: false });

  const snapshotList: InventorySnapshot[] = snapshots ?? [];

  const latestByVehicle = new Map<number, InventorySnapshot>();
  for (const s of snapshotList) {
    if (!latestByVehicle.has(s.vehicle_id)) latestByVehicle.set(s.vehicle_id, s);
  }
  const latest = Array.from(latestByVehicle.values()).filter((s) => s.status === "active");

  const vehicleIds = latest.map((s) => s.vehicle_id);
  const { data: vehicles } = vehicleIds.length
    ? await db.from("vehicles").select("*").in("id", vehicleIds)
    : { data: [] };
  const vehicleList: Vehicle[] = vehicles ?? [];

  const rows = latest.map((s) => ({
    snapshot: s,
    vehicle: vehicleList.find((v) => v.id === s.vehicle_id),
  }));

  // ── Trend chart ───────────────────────────────────────────────────
  const thirtyDaysAgo = new Date();
  thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);
  const trendMap = new Map<string, number>();
  for (const s of snapshotList) {
    if (new Date(s.snapshot_date) >= thirtyDaysAgo) {
      const date = s.snapshot_date.slice(0, 10);
      trendMap.set(date, (trendMap.get(date) ?? 0) + 1);
    }
  }
  const trendData = Array.from(trendMap.entries())
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([date, value]) => ({ date, value }));

  // Fetch vehicle info for sold/added events
  const soldVehicleIds = (soldMTD ?? []).map((e) => e.vehicle_id).filter(Boolean);
  const addedVehicleIds = (addedMTD ?? []).map((e) => e.vehicle_id).filter(Boolean);
  const allEventVehicleIds = [...new Set([...soldVehicleIds, ...addedVehicleIds])];
  const { data: eventVehicles } = allEventVehicleIds.length
    ? await db.from("vehicles").select("id, vin, year, make, model").in("id", allEventVehicleIds)
    : { data: [] };
  const evVehicleMap = new Map((eventVehicles ?? []).map((v) => [v.id, v]));

  // Fetch last known mileage for sold + added vehicles from snapshots
  const mileageMap = new Map<number, number | null>();
  const allMileageIds = [...new Set([...soldVehicleIds, ...addedVehicleIds])];
  if (allMileageIds.length > 0) {
    const { data: mileageSnaps } = await db
      .from("inventory_snapshots")
      .select("vehicle_id, mileage")
      .in("vehicle_id", allMileageIds)
      .eq("dealer_id", dealerId)
      .not("mileage", "is", null)
      .order("snapshot_date", { ascending: false });
    for (const s of mileageSnaps ?? []) {
      if (!mileageMap.has(s.vehicle_id)) mileageMap.set(s.vehicle_id, s.mileage);
    }
  }

  // ── In-stock summary metrics ─────────────────────────────────────
  const validPrices = latest.filter((s) => s.list_price != null && s.list_price > 0).map((s) => s.list_price as number);
  const avgListPrice = validPrices.length > 0 ? Math.round(validPrices.reduce((a, b) => a + b, 0) / validPrices.length) : null;

  const validYears = rows.filter((r) => r.vehicle?.year != null && r.vehicle.year > 0).map((r) => r.vehicle!.year as number);
  const avgModelYear = validYears.length > 0 ? Math.round(validYears.reduce((a, b) => a + b, 0) / validYears.length) : null;

  const validMiles = latest.filter((s) => s.mileage != null && s.mileage > 0 && s.mileage <= 300000).map((s) => s.mileage as number);
  const avgMileage = validMiles.length > 0 ? Math.round(validMiles.reduce((a, b) => a + b, 0) / validMiles.length) : null;

  return (
    <div className="p-6 space-y-6">
      {/* Header */}
      <div>
        <h1 className="text-white text-xl font-bold">{dealer?.name ?? "Dealer"}</h1>
        <p className="text-gray-500 text-xs mt-0.5">{today}</p>
      </div>

      {/* Summary Bar */}
      <div className="bg-gray-900 border border-gray-800 rounded-lg p-4 space-y-4">
        <SummaryRow label="MTD" units={mtdUnits} pace={mtdPace} avg={mtdAvg} total={mtdRevenue} />
        <div className="border-t border-gray-800" />
        <SummaryRow label="YTD" units={ytdUnits} pace={ytdPace} avg={ytdAvg} total={ytdRevenue} />
      </div>

      {/* Trend + Current Inventory */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <TrendChart data={trendData} label="Inventory Count (Last 30 Days)" color="#3b82f6" />
        <div className="bg-gray-900 border border-gray-800 rounded-lg p-4">
          <div className="grid grid-cols-2 gap-4 h-full">
            <div>
              <p className="text-gray-400 text-xs mb-1">Currently In Stock</p>
              <p className="text-white text-3xl font-bold">{latest.length}</p>
            </div>
            <div>
              <p className="text-gray-400 text-xs mb-1">Average Price</p>
              <p className="text-white text-3xl font-bold">
                {avgListPrice != null ? `$${avgListPrice.toLocaleString()}` : "N/A"}
              </p>
            </div>
            <div>
              <p className="text-gray-400 text-xs mb-1">Average Year</p>
              <p className="text-white text-3xl font-bold">
                {avgModelYear != null ? avgModelYear.toString() : "N/A"}
              </p>
            </div>
            <div>
              <p className="text-gray-400 text-xs mb-1">Average Miles</p>
              <p className="text-white text-3xl font-bold">
                {avgMileage != null ? avgMileage.toLocaleString() : "N/A"}
              </p>
            </div>
          </div>
        </div>
      </div>

      {/* Sold / Added Lists */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <div className="bg-gray-900 border border-gray-800 rounded-lg p-4">
          <h2 className="text-white font-semibold mb-4">
            Vehicles Sold MTD <span className="text-gray-500 font-normal text-xs ml-1">({(soldMTD ?? []).length})</span>
          </h2>
          <VehicleEventList
            events={(soldMTD ?? []).map(e => {
              const v = evVehicleMap.get(e.vehicle_id);
              return { vehicle_id: e.vehicle_id, event_date: e.event_date, price: e.last_seen_price, mileage: mileageMap.get(e.vehicle_id) ?? null, vin: v?.vin, year: v?.year, make: v?.make, model: v?.model };
            })}
            priceColor="text-green-400"
            emptyMessage="No sales recorded yet"
            showMileage={true}
          />
        </div>

        <div className="bg-gray-900 border border-gray-800 rounded-lg p-4">
          <h2 className="text-white font-semibold mb-4">
            Vehicles Added MTD <span className="text-gray-500 font-normal text-xs ml-1">({(addedMTD ?? []).length})</span>
          </h2>
          <VehicleEventList
            events={(addedMTD ?? []).map(e => {
              const v = evVehicleMap.get(e.vehicle_id);
              return { vehicle_id: e.vehicle_id, event_date: e.event_date, price: e.price_at_listing, mileage: mileageMap.get(e.vehicle_id) ?? null, vin: v?.vin, year: v?.year, make: v?.make, model: v?.model };
            })}
            priceColor="text-blue-400"
            emptyMessage="No additions recorded yet"
            showMileage={true}
          />
        </div>
      </div>

      {/* Full Inventory Table */}
      <div className="bg-gray-900 border border-gray-800 rounded-lg p-4">
        <h2 className="text-white font-semibold mb-4">Current Inventory</h2>
        <InventoryTable rows={rows} />
      </div>
    </div>
  );
}
// force redeploy Fri Apr  3 15:27:51 PDT 2026
