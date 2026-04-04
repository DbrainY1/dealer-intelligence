"use client";

import { useState, useMemo } from "react";
import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  ResponsiveContainer,
} from "recharts";
import type { Dealer, InventorySnapshot } from "@/types";

export interface DealerStat {
  id: number;
  name: string;
  inStock: number;
  mtdSold: number;
  sellThrough: number;
  avgYear: number | null;
  avgMiles: number | null;
  avgListPrice: number | null;
  totalValue: number;
}

type SortKey = Exclude<keyof DealerStat, "id">;

interface Props {
  dealers: Dealer[];
  dealerStats: DealerStat[];
  trendSnapshots?: InventorySnapshot[];
}

const COLORS = ["#3b82f6", "#f59e0b", "#10b981", "#f97316", "#a855f7", "#ef4444"];

const OWN_DEALERS: { match: string; color: string }[] = [
  { match: "baja east",      color: "#3b82f6" },
  { match: "baja west",      color: "#10b981" },
  { match: "newport motors", color: "#f59e0b" },
];

const COLUMNS: { key: SortKey; label: string; width: string; align: "left" | "right" }[] = [
  { key: "name",         label: "Dealer",                width: "w-44", align: "left"  },
  { key: "inStock",      label: "In Stock",              width: "w-24", align: "right" },
  { key: "mtdSold",      label: "MTD Sold",              width: "w-24", align: "right" },
  { key: "sellThrough",  label: "Sell-Through",          width: "w-28", align: "right" },
  { key: "avgYear",      label: "Avg Year",              width: "w-24", align: "right" },
  { key: "avgMiles",     label: "Avg Miles",             width: "w-28", align: "right" },
  { key: "avgListPrice", label: "Avg List Price",        width: "w-32", align: "right" },
  { key: "totalValue",   label: "Total Inventory Value", width: "w-40", align: "right" },
];

function getAccentColor(name: string): string | null {
  const lower = name.toLowerCase();
  return OWN_DEALERS.find((o) => lower.includes(o.match))?.color ?? null;
}

function formatCell(key: SortKey, stat: DealerStat): string {
  switch (key) {
    case "name":         return stat.name;
    case "inStock":      return stat.inStock.toLocaleString();
    case "mtdSold":      return stat.mtdSold.toLocaleString();
    case "sellThrough":  return `${stat.sellThrough.toFixed(1)}%`;
    case "avgYear":      return stat.avgYear != null ? String(stat.avgYear) : "N/A";
    case "avgMiles":     return stat.avgMiles != null ? stat.avgMiles.toLocaleString() : "N/A";
    case "avgListPrice": return stat.avgListPrice != null ? `$${stat.avgListPrice.toLocaleString()}` : "N/A";
    case "totalValue":   return `$${stat.totalValue.toLocaleString()}`;
  }
}

export default function CompareClient({ dealers, dealerStats, trendSnapshots }: Props) {
  const [selected, setSelected] = useState<number[]>([]);
  const [sortCol, setSortCol] = useState<SortKey | null>(null);
  const [sortDir, setSortDir] = useState<"asc" | "desc">("asc");

  const toggleDealer = (id: number) =>
    setSelected((prev) => prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]);

  const selectedDealers = dealers.filter((d) => selected.includes(d.id));

  const handleSort = (col: SortKey) => {
    if (sortCol === col) {
      if (sortDir === "asc") {
        setSortDir("desc");
      } else {
        setSortCol(null);
        setSortDir("asc");
      }
    } else {
      setSortCol(col);
      setSortDir("asc");
    }
  };

  const selectedStats = useMemo(() => {
    const stats = dealerStats.filter((s) => selected.includes(s.id));
    if (!sortCol) return stats;
    return [...stats].sort((a, b) => {
      const aVal = a[sortCol];
      const bVal = b[sortCol];
      if (aVal == null && bVal == null) return 0;
      if (aVal == null) return 1;
      if (bVal == null) return -1;
      if ((aVal as string | number) < (bVal as string | number)) return sortDir === "asc" ? -1 : 1;
      if ((aVal as string | number) > (bVal as string | number)) return sortDir === "asc" ? 1 : -1;
      return 0;
    });
  }, [dealerStats, selected, sortCol, sortDir]);

  const marketAvgSellThrough = useMemo(() => {
    if (selectedStats.length === 0) return 0;
    return selectedStats.reduce((sum, s) => sum + s.sellThrough, 0) / selectedStats.length;
  }, [selectedStats]);

  // Trend chart data
  const dateSet = new Set<string>();
  for (const s of trendSnapshots ?? []) dateSet.add(s.snapshot_date.slice(0, 10));
  const dates = Array.from(dateSet).sort().slice(-30);
  const trendData = dates.map((date) => {
    const row: Record<string, string | number> = { date };
    for (const d of selectedDealers) {
      row[d.name] = (trendSnapshots ?? []).filter(
        (s) => s.dealer_id === d.id && s.snapshot_date.slice(0, 10) === date && s.status === "active"
      ).length;
    }
    return row;
  });

  const exportCsv = () => {
    if (!selectedStats.length) return;
    const headers = COLUMNS.map((c) => c.label);
    const rows = [
      headers,
      ...selectedStats.map((stat) => COLUMNS.map((c) => formatCell(c.key, stat))),
    ];
    const csv = rows.map((r) => r.map((v) => `"${v}"`).join(",")).join("\n");
    const blob = new Blob([csv], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "comparison.csv";
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="p-6 space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <h1 className="text-white text-xl font-bold">Comparison Tool</h1>
        <div className="flex gap-2">
          <button
            onClick={() => setSelected(dealers.map((d) => d.id))}
            className="px-4 py-2 bg-gray-700 hover:bg-gray-600 text-white text-sm rounded transition-colors"
          >
            Select All
          </button>
          <button
            onClick={() => setSelected([])}
            disabled={selected.length === 0}
            className="px-4 py-2 bg-gray-700 hover:bg-gray-600 disabled:opacity-40 text-white text-sm rounded transition-colors"
          >
            Clear All
          </button>
          <button
            onClick={exportCsv}
            disabled={selectedStats.length === 0}
            className="px-4 py-2 bg-blue-600 hover:bg-blue-500 disabled:opacity-40 text-white text-sm rounded transition-colors"
          >
            Export CSV
          </button>
        </div>
      </div>

      {/* Dealer selection */}
      <div className="bg-gray-900 border border-gray-800 rounded-lg p-4">
        <p className="text-gray-400 text-sm mb-3">Select dealers to compare:</p>
        <div className="flex flex-wrap gap-2">
          {dealers.map((d) => (
            <button
              key={d.id}
              onClick={() => toggleDealer(d.id)}
              className={`px-3 py-1.5 rounded text-sm transition-colors ${
                selected.includes(d.id)
                  ? "bg-blue-600 text-white"
                  : "bg-gray-800 text-gray-300 hover:bg-gray-700"
              }`}
            >
              {d.name}
            </button>
          ))}
        </div>
      </div>

      {selectedStats.length > 0 && (
        <>
          {/* Column-aligned row table */}
          <div className="bg-gray-900 border border-gray-800 rounded-lg overflow-x-auto">
            {/* Column header bar */}
            <div className="flex items-center px-4 py-2 border-b border-gray-700 bg-gray-800 min-w-max">
              <div style={{ width: 3, flexShrink: 0 }} />
              {COLUMNS.map((col) => (
                <button
                  key={col.key}
                  onClick={() => handleSort(col.key)}
                  className={`${col.width} flex-shrink-0 px-2 text-xs font-semibold text-gray-400 uppercase tracking-wider hover:text-white transition-colors flex items-center gap-1 ${
                    col.align === "right" ? "justify-end" : "justify-start"
                  }`}
                >
                  {col.label}
                  {sortCol === col.key && (
                    <span className="text-blue-400">{sortDir === "asc" ? "↑" : "↓"}</span>
                  )}
                </button>
              ))}
            </div>

            {/* Data rows */}
            <div className="min-w-max">
              {selectedStats.map((stat, i) => {
                const accent = getAccentColor(stat.name);
                return (
                  <div
                    key={stat.id}
                    className={`flex items-center px-4 border-b border-gray-800 last:border-0 h-11 ${
                      i % 2 === 0 ? "bg-gray-900" : "bg-gray-800/40"
                    }`}
                    style={{ borderLeft: `3px solid ${accent ?? "transparent"}` }}
                  >
                    {COLUMNS.map((col) => {
                      let colorClass = "text-gray-200 text-right";
                      if (col.key === "name") {
                        colorClass = "text-white font-bold truncate";
                      } else if (col.key === "avgMiles" && stat.avgMiles != null && stat.avgMiles > 150000) {
                        colorClass = "text-amber-400 text-right";
                      } else if (col.key === "sellThrough") {
                        if (stat.sellThrough === 0) colorClass = "text-gray-500 text-right";
                        else if (stat.sellThrough >= marketAvgSellThrough) colorClass = "text-green-400 text-right";
                        else colorClass = "text-red-400 text-right";
                      }
                      return (
                        <div key={col.key} className={`${col.width} flex-shrink-0 px-2 text-sm ${colorClass}`}>
                          {formatCell(col.key, stat)}
                        </div>
                      );
                    })}
                  </div>
                );
              })}
            </div>
          </div>

          {/* Trend chart */}
          <div className="bg-gray-900 border border-gray-800 rounded-lg p-4">
            <p className="text-gray-400 text-sm mb-3">Inventory Trend (Last 30 Days)</p>
            <ResponsiveContainer width="100%" height={250}>
              <LineChart data={trendData}>
                <CartesianGrid strokeDasharray="3 3" stroke="#374151" />
                <XAxis dataKey="date" tick={{ fill: "#9ca3af", fontSize: 10 }} />
                <YAxis tick={{ fill: "#9ca3af", fontSize: 10 }} />
                <Tooltip contentStyle={{ backgroundColor: "#111827", border: "1px solid #374151", color: "#fff" }} />
                <Legend wrapperStyle={{ color: "#9ca3af", fontSize: 12 }} />
                {selectedDealers.map((d, i) => (
                  <Line key={d.id} type="monotone" dataKey={d.name} stroke={COLORS[i % COLORS.length]} dot={false} strokeWidth={2} />
                ))}
              </LineChart>
            </ResponsiveContainer>
          </div>
        </>
      )}
    </div>
  );
}
