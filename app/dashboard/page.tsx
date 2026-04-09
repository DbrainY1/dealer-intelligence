export const dynamic = "force-dynamic";

import { createServerSupabase } from "@/lib/supabase-server";
import type { Dealer } from "@/types";
import MarketCharts from "./MarketCharts";
import type { ReactNode } from "react";

// ── Local UI helpers ──────────────────────────────────────────────────────────

function Delta({
  current,
  prior,
  type,
}: {
  current: number | null;
  prior: number | null;
  type: "count" | "price" | "pct";
}): ReactNode {
  if (current === null || prior === null) return null;
  const diff = current - prior;
  const arrow = diff >= 0 ? "↑" : "↓";
  const color =
    diff > 0 ? "text-green-400" : diff < 0 ? "text-red-400" : "text-amber-400";
  let diffStr: string;
  if (type === "price") {
    diffStr = `${diff >= 0 ? "+$" : "-$"}${Math.abs(Math.round(diff)).toLocaleString()}`;
  } else if (type === "pct") {
    diffStr = `${diff >= 0 ? "+" : ""}${diff.toFixed(1)}pp`;
  } else {
    diffStr = `${diff >= 0 ? "+" : ""}${diff}`;
  }
  return <span className={color}>{arrow} {diffStr}</span>;
}

function IntelCard({
  accent,
  label,
  primary,
  line1Label,
  line1Value,
  line1Delta,
  line2Label,
  line2Value,
  line2Delta,
}: {
  accent: string;
  label: string;
  primary: string;
  line1Label: string;
  line1Value: string;
  line1Delta: ReactNode;
  line2Label: string;
  line2Value: string;
  line2Delta: ReactNode;
}) {
  return (
    <div className="bg-gray-900 rounded-lg overflow-hidden border border-gray-800">
      <div className={`h-[3px] ${accent}`} />
      <div className="p-3 space-y-1.5">
        <p className={`${accent.replace('bg-', 'text-')} text-2xl font-bold uppercase tracking-widest`}>{label}</p>
        <p className="text-white text-4xl font-bold">{primary}</p>
        <div className="space-y-0.5 pt-0.5">
          <p className="text-sm font-mono text-gray-400">
            <span className="text-gray-500">Last mo:</span>{" "}
            {line1Value}{line1Delta ? <> {line1Delta}</> : null}
          </p>
          <p className="text-sm font-mono text-gray-400">
            <span className="text-gray-500">Last yr:</span>{" "}
            {line2Value}{line2Delta ? <> {line2Delta}</> : null}
          </p>
        </div>
      </div>
    </div>
  );
}

// ── Comparison snapshot helper ────────────────────────────────────────────────

async function getSnapshotStats(
  supabase: Awaited<ReturnType<typeof createServerSupabase>>,
  cutoffStr: string
): Promise<{ activeDealers: number; inventory: number; avgPrice: number | null } | null> {
  const { data: dateRow } = await supabase
    .from("inventory_snapshots")
    .select("snapshot_date")
    .lte("snapshot_date", cutoffStr)
    .order("snapshot_date", { ascending: false })
    .limit(1)
    .single();

  if (!dateRow) return null;

  const snapDate = dateRow.snapshot_date;

  const [dealerRes, countRes, priceRes] = await Promise.all([
    supabase
      .from("inventory_snapshots")
      .select("dealer_id")
      .eq("snapshot_date", snapDate),
    supabase
      .from("inventory_snapshots")
      .select("id", { count: "exact", head: true })
      .eq("snapshot_date", snapDate),
    supabase
      .from("inventory_snapshots")
      .select("list_price")
      .eq("snapshot_date", snapDate)
      .not("list_price", "is", null),
  ]);

  const activeDealers = new Set(
    (dealerRes.data ?? []).map((r: { dealer_id: number }) => r.dealer_id)
  ).size;
  const inventory = countRes.count ?? 0;
  const prices = (priceRes.data ?? []) as { list_price: number }[];
  const avgPrice =
    prices.length > 0
      ? Math.round(prices.reduce((s, r) => s + r.list_price, 0) / prices.length)
      : null;

  return { activeDealers, inventory, avgPrice };
}

// ── Page ──────────────────────────────────────────────────────────────────────

export default async function DashboardPage() {
  const supabase = await createServerSupabase();

  const { data: dealers } = await supabase.from("dealers").select("*");
  const dealerList: Dealer[] = dealers ?? [];

  // Dynamic date anchors
  const today = new Date();
  const monthStart = new Date(today.getFullYear(), today.getMonth(), 1);
  const monthStartStr = monthStart.toISOString().split("T")[0];

  const lastMoCutoff = new Date(today);
  lastMoCutoff.setMonth(lastMoCutoff.getMonth() - 1);
  const lastMoCutoffStr = lastMoCutoff.toISOString().split("T")[0];

  const lastMoMonthStart = new Date(lastMoCutoff.getFullYear(), lastMoCutoff.getMonth(), 1);
  const lastMoMonthStartStr = lastMoMonthStart.toISOString().split("T")[0];

  const lastYrCutoff = new Date(today);
  lastYrCutoff.setFullYear(lastYrCutoff.getFullYear() - 1);
  const lastYrCutoffStr = lastYrCutoff.toISOString().split("T")[0];

  const lastYrMonthStart = new Date(lastYrCutoff.getFullYear(), lastYrCutoff.getMonth(), 1);
  const lastYrMonthStartStr = lastYrMonthStart.toISOString().split("T")[0];

  // Monthly sold counts — current + comparison months
  const { data: allMonthlySales } = await supabase
    .from("monthly_sales")
    .select("dealer_id, units_sold, month_start")
    .in("month_start", [monthStartStr, lastMoMonthStartStr, lastYrMonthStartStr]);

  const sumSoldForMonth = (ms: string) =>
    (allMonthlySales ?? [])
      .filter((r: { month_start: string; units_sold: number }) => r.month_start === ms)
      .reduce((s: number, r: { units_sold: number }) => s + (r.units_sold ?? 0), 0);

  const soldThisMonth = sumSoldForMonth(monthStartStr);
  const soldLastMo = sumSoldForMonth(lastMoMonthStartStr);
  const soldLastYr = sumSoldForMonth(lastYrMonthStartStr);

  // Per-dealer today: latest snapshot count + sales + added + transferred (MTD)
  const byDealer = await Promise.all(
    dealerList.map(async (d) => {
      const { data: latestDate } = await supabase
        .from("inventory_snapshots")
        .select("snapshot_date")
        .eq("dealer_id", d.id)
        .order("snapshot_date", { ascending: false })
        .limit(1)
        .single();

      if (!latestDate) return { name: d.name, count: 0, sold: 0, added: 0, transferred: 0 };

      const { count } = await supabase
        .from("inventory_snapshots")
        .select("id", { count: "exact" })
        .eq("dealer_id", d.id)
        .eq("snapshot_date", latestDate.snapshot_date);

      const soldByDealer = (allMonthlySales ?? []).find(
        (r: { dealer_id: number; month_start: string }) =>
          r.dealer_id === d.id && r.month_start === monthStartStr
      );

      // Count MTD added and transferred (arriving at this dealer)
      const { data: addedEvents } = await supabase
        .from("inventory_events")
        .select("id", { count: "exact" })
        .eq("to_dealer_id", d.id)
        .eq("event_type", "added")
        .gte("event_date", monthStartStr);

      const { data: transferredEvents } = await supabase
        .from("inventory_events")
        .select("id", { count: "exact" })
        .eq("to_dealer_id", d.id)
        .eq("event_type", "transferred")
        .gte("event_date", monthStartStr);

      return {
        name: d.name,
        count: count ?? 0,
        sold: soldByDealer?.units_sold ?? 0,
        added: addedEvents?.length ?? 0,
        transferred: transferredEvents?.length ?? 0,
      };
    })
  );

  const activeDealersToday = byDealer.filter((d) => d.count > 0).length;
  const totalInventory = byDealer.reduce((sum, d) => sum + d.count, 0);

  // Avg price today
  let totalPriceSum = 0;
  let totalPriceCount = 0;
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
        .select("list_price")
        .eq("dealer_id", d.id)
        .eq("snapshot_date", latest.snapshot_date)
        .not("list_price", "is", null);
      for (const s of snaps ?? []) {
        totalPriceSum += s.list_price ?? 0;
        totalPriceCount++;
      }
    })
  );
  const avgPrice = totalPriceCount > 0 ? Math.round(totalPriceSum / totalPriceCount) : 0;

  // Sell-through today
  const sellThroughToday =
    totalInventory > 0 ? (soldThisMonth / totalInventory) * 100 : null;

  // Comparison snapshot stats (parallel)
  const [lastMoStats, lastYrStats] = await Promise.all([
    getSnapshotStats(supabase, lastMoCutoffStr),
    getSnapshotStats(supabase, lastYrCutoffStr),
  ]);

  // Sell-through for comparison periods
  const sellThroughLastMo =
    lastMoStats && lastMoStats.inventory > 0 && soldLastMo > 0
      ? (soldLastMo / lastMoStats.inventory) * 100
      : lastMoStats
      ? null
      : null;

  const sellThroughLastYr =
    lastYrStats && lastYrStats.inventory > 0 && soldLastYr > 0
      ? (soldLastYr / lastYrStats.inventory) * 100
      : lastYrStats
      ? null
      : null;

  // Format helpers
  const fmtCount = (v: number | null) => (v === null ? "N/A" : v.toLocaleString());
  const fmtPrice = (v: number | null) =>
    v === null ? "N/A" : `$${v.toLocaleString()}`;
  const fmtPct = (v: number | null) => (v === null ? "N/A" : `${v.toFixed(1)}%`);

  return (
    <div className="p-6 space-y-6">
      <h1 className="text-white text-xl font-bold">
        Market Overview —{" "}
        {today.toLocaleDateString("en-US", {
          month: "long",
          day: "numeric",
          year: "numeric",
          timeZone: "America/Los_Angeles",
        })}
      </h1>

      {/* 2×2 Intel Cards */}
      <div className="grid grid-cols-2 gap-3 max-w-[900px]">
        <IntelCard
          accent="bg-blue-500"
          label="Active Dealers"
          primary={activeDealersToday.toString()}
          line1Label="Last mo"
          line1Value={fmtCount(lastMoStats?.activeDealers ?? null)}
          line1Delta={
            <Delta current={activeDealersToday} prior={lastMoStats?.activeDealers ?? null} type="count" />
          }
          line2Label="Last yr"
          line2Value={fmtCount(lastYrStats?.activeDealers ?? null)}
          line2Delta={
            <Delta current={activeDealersToday} prior={lastYrStats?.activeDealers ?? null} type="count" />
          }
        />

        <IntelCard
          accent="bg-violet-500"
          label="Inventory Level"
          primary={totalInventory.toLocaleString()}
          line1Label="Last mo"
          line1Value={fmtCount(lastMoStats?.inventory ?? null)}
          line1Delta={
            <Delta current={totalInventory} prior={lastMoStats?.inventory ?? null} type="count" />
          }
          line2Label="Last yr"
          line2Value={fmtCount(lastYrStats?.inventory ?? null)}
          line2Delta={
            <Delta current={totalInventory} prior={lastYrStats?.inventory ?? null} type="count" />
          }
        />

        <IntelCard
          accent="bg-emerald-500"
          label="Avg List Price"
          primary={`$${avgPrice.toLocaleString()}`}
          line1Label="Last mo"
          line1Value={fmtPrice(lastMoStats?.avgPrice ?? null)}
          line1Delta={
            <Delta current={avgPrice} prior={lastMoStats?.avgPrice ?? null} type="price" />
          }
          line2Label="Last yr"
          line2Value={fmtPrice(lastYrStats?.avgPrice ?? null)}
          line2Delta={
            <Delta current={avgPrice} prior={lastYrStats?.avgPrice ?? null} type="price" />
          }
        />

        <IntelCard
          accent="bg-amber-500"
          label="Sell-Through Pace"
          primary={fmtPct(sellThroughToday)}
          line1Label="Last mo"
          line1Value={fmtPct(sellThroughLastMo)}
          line1Delta={
            <Delta current={sellThroughToday} prior={sellThroughLastMo} type="pct" />
          }
          line2Label="Last yr"
          line2Value={fmtPct(sellThroughLastYr)}
          line2Delta={
            <Delta current={sellThroughToday} prior={sellThroughLastYr} type="pct" />
          }
        />
      </div>

      <MarketCharts byDealer={byDealer} dealers={dealerList} />
    </div>
  );
}
