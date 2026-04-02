"use client";
import { useState } from "react";
import KPICard from "@/components/KPICard";
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

const COLORS = ["#3b82f6", "#f59e0b", "#10b981", "#f97316", "#a855f7", "#ef4444"];

interface Props {
  dealers: Dealer[];
  snapshots: InventorySnapshot[];
  trendSnapshots?: InventorySnapshot[];
}

export default function CompareClient({ dealers, snapshots, trendSnapshots }: Props) {
  const [selected, setSelected] = useState<number[]>([]);

  const toggleDealer = (id: number) =>
    setSelected((prev) => prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]);

  const selectedDealers = dealers.filter((d) => selected.includes(d.id));

  const latestByVin = new Map<string, InventorySnapshot>();
  for (const s of snapshots) {
    const key = `${s.vehicle_id}:${s.dealer_id}`;
    if (!latestByVin.has(key)) latestByVin.set(key, s);
  }
  const latest = Array.from(latestByVin.values());

  // Trend data — use trendSnapshots if provided, else fall back to snapshots
  const trendSource = trendSnapshots ?? snapshots;
  const dateSet = new Set<string>();
  for (const s of trendSource) dateSet.add(s.snapshot_date.slice(0, 10));
  const dates = Array.from(dateSet).sort().slice(-30);

  const trendData = dates.map((date) => {
    const row: Record<string, string | number> = { date };
    for (const d of selectedDealers) {
      row[d.name] = trendSource.filter(
        (s) => s.dealer_id === d.id && s.snapshot_date.slice(0, 10) === date && s.status === "active"
      ).length;
    }
    return row;
  });

  const exportCsv = () => {
    if (!selectedDealers.length) return;
    const rows = [["Dealer", "In Stock", "Avg Price", "Avg Days on Lot"]];
    for (const d of selectedDealers) {
      const ds = latest.filter((s) => s.dealer_id === d.id && s.status === "active");
      const pricedDs = ds.filter((s) => s.list_price != null);
      const avgPrice = pricedDs.length ? Math.round(pricedDs.reduce((sum, s) => sum + s.list_price!, 0) / pricedDs.length) : 0;
      const avgDays = 0; // days_on_lot not in schema — calculated from vin_presence
      rows.push([d.name, String(ds.length), String(avgPrice), String(avgDays)]);
    }
    const csv = rows.map((r) => r.join(",")).join("\n");
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
      <div className="flex items-center justify-between">
        <h1 className="text-white text-xl font-bold">Comparison Tool</h1>
        <button
          onClick={exportCsv}
          disabled={selectedDealers.length === 0}
          className="px-4 py-2 bg-blue-600 hover:bg-blue-500 disabled:opacity-40 text-white text-sm rounded transition-colors"
        >
          Export CSV
        </button>
      </div>
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
      {selectedDealers.length > 0 && (
        <>
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
            {selectedDealers.map((d) => {
              const ds = latest.filter((s) => s.dealer_id === d.id && s.status === "active");
              const priced = ds.filter((s) => s.list_price != null);
              const total = Math.round(priced.reduce((sum, s) => sum + s.list_price!, 0));
              const avgPrice = priced.length ? Math.round(total / priced.length) : 0;
              return (
                <div key={d.id} className="bg-gray-900 border border-gray-800 rounded-lg p-4">
                  <p className="text-white font-bold text-base mb-1">{d.name}</p>
                  <p className="text-white text-xl font-bold">{ds.length} units</p>
                  <p className="text-gray-400 text-xs mt-2">Total: {total > 0 ? `$${total.toLocaleString()}` : "—"}</p>
                  <p className="text-gray-400 text-xs mt-1">Avg: {avgPrice > 0 ? `$${avgPrice.toLocaleString()}` : "—"}</p>
                </div>
              );
            })}
          </div>
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
