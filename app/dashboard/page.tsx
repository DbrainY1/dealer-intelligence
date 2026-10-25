export const dynamic = "force-dynamic";

import { createServerSupabase } from "@/lib/supabase-server";
import RoleGuard from "@/components/RoleGuard";
import { cutoffLabel } from "@/lib/cutoff";
import { loadMarketOverview } from "@/lib/dashboard-data";
import { parseScope } from "@/lib/freshness";
import MarketScopeBar from "@/components/MarketScopeBar";
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

// ── Page ──────────────────────────────────────────────────────────────────────

export default async function DashboardPage({
  searchParams,
}: {
  searchParams: Promise<{ scope?: string | string[] }>;
}) {
  const supabase = await createServerSupabase();
  const scope = parseScope((await searchParams).scope);

  const {
    dealerList,
    byDealer,
    canonicalCutoff,
    activeDealersToday,
    totalInventory,
    avgPrice,
    sellThroughToday,
    sellThroughLastMo,
    sellThroughLastYr,
    lastMoStats,
    lastYrStats,
    excludedDealers,
    monitoredDealerCount,
  } = await loadMarketOverview(supabase, new Date(), scope);

  const today = new Date();

  // Format helpers
  const fmtCount = (v: number | null) => (v === null ? "N/A" : v.toLocaleString());
  const fmtPrice = (v: number | null) =>
    v === null ? "N/A" : `$${v.toLocaleString()}`;
  const fmtPct = (v: number | null) => (v === null ? "N/A" : `${v.toFixed(1)}%`);

  return (
    <RoleGuard roles={['developer', 'dealer_principal', 'viewer']}>
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

        <MarketScopeBar
          scope={scope}
          basePath="/dashboard"
          cohortCount={dealerList.length}
          monitoredCount={monitoredDealerCount}
          excluded={excludedDealers}
        />

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
            accent="bg-emerald-500"
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

        <MarketCharts
          byDealer={byDealer}
          dealers={dealerList}
          soldColumnLabel={canonicalCutoff ? (cutoffLabel(canonicalCutoff, "Sold Since") ?? undefined) : undefined}
          velocityTitle={canonicalCutoff ? `Sales Velocity (${cutoffLabel(canonicalCutoff)})` : undefined}
        />
      </div>
    </RoleGuard>
  );
}
