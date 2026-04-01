"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import type { InventorySnapshot, Vehicle } from "@/types";

interface Row {
  snapshot: InventorySnapshot;
  vehicle?: Vehicle;
}

interface InventoryTableProps {
  rows: Row[];
}

type SortKey = "vin" | "year" | "make" | "model" | "list_price" | "days_on_lot" | "status";

export default function InventoryTable({ rows }: InventoryTableProps) {
  const router = useRouter();
  const [sortKey, setSortKey] = useState<SortKey>("days_on_lot");
  const [sortDir, setSortDir] = useState<"asc" | "desc">("desc");
  const [filter, setFilter] = useState("");

  const toggleSort = (key: SortKey) => {
    if (sortKey === key) {
      setSortDir(sortDir === "asc" ? "desc" : "asc");
    } else {
      setSortKey(key);
      setSortDir("asc");
    }
  };

  const filtered = rows.filter((r) => {
    const q = filter.toLowerCase();
    return (
      r.snapshot.vin.toLowerCase().includes(q) ||
      r.vehicle?.make?.toLowerCase().includes(q) ||
      r.vehicle?.model?.toLowerCase().includes(q)
    );
  });

  const sorted = [...filtered].sort((a, b) => {
    let aVal: string | number | null = null;
    let bVal: string | number | null = null;
    if (sortKey === "vin") { aVal = a.snapshot.vin; bVal = b.snapshot.vin; }
    else if (sortKey === "year") { aVal = a.vehicle?.year ?? 0; bVal = b.vehicle?.year ?? 0; }
    else if (sortKey === "make") { aVal = a.vehicle?.make ?? ""; bVal = b.vehicle?.make ?? ""; }
    else if (sortKey === "model") { aVal = a.vehicle?.model ?? ""; bVal = b.vehicle?.model ?? ""; }
    else if (sortKey === "list_price") { aVal = a.snapshot.list_price ?? 0; bVal = b.snapshot.list_price ?? 0; }
    else if (sortKey === "days_on_lot") { aVal = a.snapshot.days_on_lot ?? 0; bVal = b.snapshot.days_on_lot ?? 0; }
    else if (sortKey === "status") { aVal = a.snapshot.status ?? ""; bVal = b.snapshot.status ?? ""; }

    if (aVal === null) aVal = "";
    if (bVal === null) bVal = "";
    const cmp = aVal < bVal ? -1 : aVal > bVal ? 1 : 0;
    return sortDir === "asc" ? cmp : -cmp;
  });

  const headers: { key: SortKey; label: string }[] = [
    { key: "vin", label: "VIN" },
    { key: "year", label: "Year" },
    { key: "make", label: "Make" },
    { key: "model", label: "Model" },
    { key: "list_price", label: "Price" },
    { key: "days_on_lot", label: "Days on Lot" },
    { key: "status", label: "Status" },
  ];

  return (
    <div>
      <input
        type="text"
        placeholder="Filter by VIN, make, model..."
        value={filter}
        onChange={(e) => setFilter(e.target.value)}
        className="mb-3 px-3 py-2 bg-gray-800 border border-gray-700 rounded text-white text-sm w-full max-w-sm"
      />
      <div className="overflow-x-auto">
        <table className="w-full text-sm text-left text-gray-300">
          <thead className="text-xs text-gray-400 uppercase bg-gray-800">
            <tr>
              {headers.map((h) => (
                <th
                  key={h.key}
                  className="px-4 py-3 cursor-pointer hover:text-white select-none"
                  onClick={() => toggleSort(h.key)}
                >
                  {h.label} {sortKey === h.key ? (sortDir === "asc" ? "↑" : "↓") : ""}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {sorted.map((r) => (
              <tr
                key={r.snapshot.vin + r.snapshot.id}
                className="border-b border-gray-800 hover:bg-gray-800 cursor-pointer"
                onClick={() => router.push(`/dashboard/vin/${r.snapshot.vin}`)}
              >
                <td className="px-4 py-3 font-mono text-blue-400">{r.snapshot.vin}</td>
                <td className="px-4 py-3">{r.vehicle?.year ?? "—"}</td>
                <td className="px-4 py-3">{r.vehicle?.make ?? "—"}</td>
                <td className="px-4 py-3">{r.vehicle?.model ?? "—"}</td>
                <td className="px-4 py-3">
                  {r.snapshot.list_price != null
                    ? `$${r.snapshot.list_price.toLocaleString()}`
                    : "—"}
                </td>
                <td className="px-4 py-3">{r.snapshot.days_on_lot ?? "—"}</td>
                <td className="px-4 py-3">
                  <span
                    className={`px-2 py-0.5 rounded text-xs ${
                      r.snapshot.status === "active"
                        ? "bg-green-900 text-green-300"
                        : "bg-gray-700 text-gray-300"
                    }`}
                  >
                    {r.snapshot.status ?? "—"}
                  </span>
                </td>
              </tr>
            ))}
            {sorted.length === 0 && (
              <tr>
                <td colSpan={7} className="px-4 py-6 text-center text-gray-500">
                  No results
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
