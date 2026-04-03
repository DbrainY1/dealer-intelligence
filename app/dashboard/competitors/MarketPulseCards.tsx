"use client";

import { useState } from "react";

export interface ScorecardRow {
  id: number;
  name: string;
  count: number;
  sold: number;
  added: number;
  removed: number;
}

export default function MarketPulseCards({ scorecards }: { scorecards: ScorecardRow[] }) {
  const allIds = scorecards.map((s) => s.id);
  const [selected, setSelected] = useState<Set<number>>(new Set(allIds));

  const toggle = (id: number) =>
    setSelected((prev) => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });

  const selectAll = () => setSelected(new Set(allIds));
  const clear = () => setSelected(new Set());

  const exportCSV = () => {
    const rows = scorecards.filter((s) => selected.has(s.id));
    const header = "Dealer,In Stock,MTD Sold,Added This Week,Removed This Week";
    const lines = rows.map((s) => `${s.name},${s.count},${s.sold},${s.added},${s.removed}`);
    const csv = [header, ...lines].join("\n");
    const blob = new Blob([csv], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `market-pulse-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="space-y-3">
      {/* Toolbar */}
      <div className="flex items-center gap-2">
        <button
          onClick={selectAll}
          className="px-3 py-1.5 text-xs font-medium bg-gray-800 hover:bg-gray-700 text-gray-300 rounded border border-gray-700 transition-colors"
        >
          Select All
        </button>
        <button
          onClick={clear}
          className="px-3 py-1.5 text-xs font-medium bg-gray-800 hover:bg-gray-700 text-gray-300 rounded border border-gray-700 transition-colors"
        >
          Clear
        </button>
        <button
          onClick={exportCSV}
          disabled={selected.size === 0}
          className="px-3 py-1.5 text-xs font-medium bg-blue-600 hover:bg-blue-500 disabled:opacity-40 disabled:cursor-not-allowed text-white rounded border border-blue-500 transition-colors"
        >
          Export CSV {selected.size > 0 ? `(${selected.size})` : ""}
        </button>
        <span className="text-gray-600 text-xs ml-1">{selected.size} of {scorecards.length} selected</span>
      </div>

      {/* Scorecards */}
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-3">
        {scorecards.map(({ id, name, count, sold, added, removed }) => {
          const isSelected = selected.has(id);
          return (
            <div
              key={id}
              onClick={() => toggle(id)}
              className={`bg-gray-900 rounded-lg overflow-hidden cursor-pointer transition-all ${
                isSelected
                  ? "border-2 border-blue-500"
                  : "border-2 border-gray-800 opacity-50"
              }`}
            >
              {/* Dealer name header */}
              <div className={`px-3 py-2 ${isSelected ? "bg-gray-700" : "bg-gray-800"}`}>
                <p className="text-white font-bold text-sm truncate">{name}</p>
              </div>

              {/* Stats */}
              <div className="p-3 space-y-2">
                <div className="flex justify-between items-end">
                  <div>
                    <p className="text-2xl font-bold text-blue-400">{count.toLocaleString()}</p>
                    <p className="text-gray-500 text-xs">in stock</p>
                  </div>
                  <div className="text-right">
                    <p className="text-2xl font-bold text-green-400">{sold}</p>
                    <p className="text-gray-500 text-xs">MTD sold</p>
                  </div>
                </div>

                <div className="flex justify-between border-t border-gray-800 pt-2 text-xs">
                  <div className="flex items-center gap-1">
                    <span className="text-green-300 font-semibold">↑ {added}</span>
                    <span className="text-gray-500">added</span>
                  </div>
                  <div className="flex items-center gap-1">
                    <span className="text-red-300 font-semibold">↓ {removed}</span>
                    <span className="text-gray-500">removed</span>
                  </div>
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
