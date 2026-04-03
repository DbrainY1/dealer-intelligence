"use client";
import { useState, useMemo } from "react";

interface VehicleEvent {
  vehicle_id: number;
  event_date: string;
  price?: number | null;
  vin?: string | null;
  year?: number | null;
  make?: string | null;
  model?: string | null;
}

type SortKey = "vehicle" | "date" | "price";
type SortDir = "asc" | "desc";

function vehicleName(e: VehicleEvent) {
  const parts = [e.year, e.make, e.model].filter(Boolean);
  return parts.length > 0 ? parts.join(" ") : `VID-${e.vehicle_id}`;
}

export default function VehicleEventList({
  events,
  priceColor = "text-green-400",
  emptyMessage = "No records yet",
}: {
  events: VehicleEvent[];
  priceColor?: string;
  emptyMessage?: string;
}) {
  const [sortKey, setSortKey] = useState<SortKey>("date");
  const [sortDir, setSortDir] = useState<SortDir>("desc");

  function toggleSort(key: SortKey) {
    if (sortKey === key) setSortDir(d => d === "asc" ? "desc" : "asc");
    else { setSortKey(key); setSortDir("desc"); }
  }

  const sorted = useMemo(() => [...events].sort((a, b) => {
    let av: string | number, bv: string | number;
    if (sortKey === "date") { av = a.event_date ?? ""; bv = b.event_date ?? ""; }
    else if (sortKey === "price") { av = a.price ?? 0; bv = b.price ?? 0; }
    else { av = vehicleName(a).toLowerCase(); bv = vehicleName(b).toLowerCase(); }
    const cmp = av < bv ? -1 : av > bv ? 1 : 0;
    return sortDir === "asc" ? cmp : -cmp;
  }), [events, sortKey, sortDir]);

  const arrow = (key: SortKey) => sortKey === key ? (sortDir === "asc" ? " ↑" : " ↓") : "";

  if (events.length === 0) return <p className="text-gray-500 text-sm">{emptyMessage}</p>;

  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm text-left">
        <thead>
          <tr className="text-xs text-gray-500 uppercase border-b border-gray-800">
            <th className="pb-2 cursor-pointer hover:text-white select-none" onClick={() => toggleSort("vehicle")}>
              Vehicle{arrow("vehicle")}
            </th>
            <th className="pb-2 cursor-pointer hover:text-white select-none text-right" onClick={() => toggleSort("price")}>
              Price{arrow("price")}
            </th>
            <th className="pb-2 cursor-pointer hover:text-white select-none text-right" onClick={() => toggleSort("date")}>
              Date{arrow("date")}
            </th>
          </tr>
        </thead>
        <tbody className="divide-y divide-gray-800/50">
          {sorted.map((e, i) => (
            <tr key={i} className="hover:bg-gray-800/30">
              <td className="py-2 pr-4">
                <p className="text-white">{vehicleName(e)}</p>
                {e.vin && <p className="text-gray-500 text-xs font-mono">{e.vin}</p>}
              </td>
              <td className={`py-2 text-right ${priceColor} whitespace-nowrap`}>
                {e.price ? `$${Math.round(e.price).toLocaleString()}` : "—"}
              </td>
              <td className="py-2 text-right text-gray-400 whitespace-nowrap">
                {e.event_date?.slice(0, 10)}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
