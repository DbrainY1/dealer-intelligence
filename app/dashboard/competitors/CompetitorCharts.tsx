"use client";
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

const COLORS = ["#f59e0b", "#f97316", "#ef4444", "#a855f7"];

interface Props {
  dealers: Dealer[];
  snapshots: InventorySnapshot[];
}

export default function CompetitorCharts({ dealers, snapshots }: Props) {
  // Build date-keyed data
  const dateSet = new Set<string>();
  for (const s of snapshots) dateSet.add(s.snapshot_date.slice(0, 10));
  const dates = Array.from(dateSet).sort();

  const data = dates.map((date) => {
    const row: Record<string, string | number> = { date };
    for (const d of dealers) {
      const count = snapshots.filter(
        (s) => s.dealer_id === d.id && s.snapshot_date.slice(0, 10) === date && s.status === "active"
      ).length;
      row[d.name] = count;
    }
    return row;
  });

  return (
    <div className="bg-gray-900 border border-gray-800 rounded-lg p-4">
      <p className="text-gray-400 text-sm mb-3">Inventory Count Over Time (Last 90 Days)</p>
      <ResponsiveContainer width="100%" height={250}>
        <LineChart data={data}>
          <CartesianGrid strokeDasharray="3 3" stroke="#374151" />
          <XAxis dataKey="date" tick={{ fill: "#9ca3af", fontSize: 10 }} />
          <YAxis tick={{ fill: "#9ca3af", fontSize: 10 }} />
          <Tooltip contentStyle={{ backgroundColor: "#111827", border: "1px solid #374151", color: "#fff" }} />
          <Legend wrapperStyle={{ color: "#9ca3af", fontSize: 12 }} />
          {dealers.map((d, i) => (
            <Line key={d.id} type="monotone" dataKey={d.name} stroke={COLORS[i % COLORS.length]} dot={false} strokeWidth={2} />
          ))}
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}
