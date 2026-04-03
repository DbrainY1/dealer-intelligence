"use client";
import { useState, useMemo } from "react";

interface VehicleEvent {
  vehicle_id: number;
  event_date: string;
  price?: number | null;
  mileage?: number | null;
  vin?: string | null;
  year?: number | null;
  make?: string | null;
  model?: string | null;
}

type SortKey = "year" | "make" | "model" | "mileage" | "price" | "date";
type SortDir = "asc" | "desc";

const COL_HEADERS: { key: SortKey; label: string; align: string }[] = [
  { key: "date",    label: "Date",    align: "text-left" },
  { key: "year",    label: "Year",    align: "text-left" },
  { key: "make",    label: "Make",    align: "text-left" },
  { key: "model",   label: "Model",   align: "text-left" },
  { key: "mileage", label: "Miles",   align: "text-right" },
  { key: "price",   label: "Price",   align: "text-right" },
];
// VIN is always shown but not sortable

export default function VehicleEventList({
  events,
  priceColor = "text-green-400",
  emptyMessage = "No records yet",
  showMileage = true,
}: {
  events: VehicleEvent[];
  priceColor?: string;
  emptyMessage?: string;
  showMileage?: boolean;
}) {
  const [sortKey, setSortKey] = useState<SortKey>("date");
  const [sortDir, setSortDir] = useState<SortDir>("desc");

  function toggleSort(key: SortKey) {
    if (sortKey === key) setSortDir(d => d === "asc" ? "desc" : "asc");
    else { setSortKey(key); setSortDir("desc"); }
  }

  const sorted = useMemo(() => [...events].sort((a, b) => {
    let av: string | number, bv: string | number;
    switch (sortKey) {
      case "year":    av = a.year ?? 0;           bv = b.year ?? 0; break;
      case "make":    av = (a.make ?? "").toLowerCase(); bv = (b.make ?? "").toLowerCase(); break;
      case "model":   av = (a.model ?? "").toLowerCase(); bv = (b.model ?? "").toLowerCase(); break;
      case "mileage": av = a.mileage ?? 0;        bv = b.mileage ?? 0; break;
      case "price":   av = a.price ?? 0;          bv = b.price ?? 0; break;
      default:        av = a.event_date ?? "";    bv = b.event_date ?? "";
    }
    const cmp = av < bv ? -1 : av > bv ? 1 : 0;
    return sortDir === "asc" ? cmp : -cmp;
  }), [events, sortKey, sortDir]);

  const arrow = (key: SortKey) => sortKey === key ? (sortDir === "asc" ? " ↑" : " ↓") : "";

  if (events.length === 0) return <p className="text-gray-500 text-sm">{emptyMessage}</p>;

  const visibleCols = showMileage ? COL_HEADERS : COL_HEADERS.filter(c => c.key !== "mileage");

  return (
    <div className="overflow-x-auto max-h-96 overflow-y-auto">
      <table className="w-full text-sm text-left min-w-[500px]">
        <thead className="sticky top-0 bg-gray-900 z-10">
          <tr className="text-xs text-gray-500 uppercase border-b border-gray-800">
            {visibleCols.map(col => (
              <th
                key={col.key}
                className={`pb-2 pr-3 cursor-pointer hover:text-white select-none whitespace-nowrap ${col.align}`}
                onClick={() => toggleSort(col.key)}
              >
                {col.label}{arrow(col.key)}
              </th>
            ))}
            <th className="pb-2 text-right whitespace-nowrap text-gray-600">VIN</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-gray-800/40">
          {sorted.map((e, i) => (
            <tr key={i} className="hover:bg-gray-800/30">
              <td className="py-2 pr-3 text-gray-400 whitespace-nowrap">{e.event_date?.slice(0, 10)}</td>
              <td className="py-2 pr-3 text-white whitespace-nowrap">{e.year ?? "—"}</td>
              <td className="py-2 pr-3 text-white whitespace-nowrap">{e.make ?? "—"}</td>
              <td className="py-2 pr-3 text-gray-300 whitespace-nowrap">{e.model ?? "—"}</td>
              {showMileage && (
                <td className="py-2 pr-3 text-right text-gray-400 whitespace-nowrap">
                  {e.mileage ? e.mileage.toLocaleString() : "—"}
                </td>
              )}
              <td className={`py-2 pr-3 text-right whitespace-nowrap ${priceColor}`}>
                {e.price ? `$${Math.round(e.price).toLocaleString()}` : "—"}
              </td>
              <td className="py-2 text-right font-mono text-gray-600 whitespace-nowrap" style={{fontSize: "0.65rem"}}>
                {e.vin ?? "—"}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
