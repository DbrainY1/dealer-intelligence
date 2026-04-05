"use client";

import { useState, useEffect } from "react";
import MarketPulseCards, { ScorecardRow } from "./MarketPulseCards";
import CompetitorCharts from "./CompetitorCharts";
import type { Dealer, InventorySnapshot, InventoryEvent } from "@/types";

interface Props {
  scorecards: ScorecardRow[];
  dealers: Dealer[];
  snapshots: InventorySnapshot[];
  eventList: InventoryEvent[];
}

export default function CompetitorsPageClient({
  scorecards,
  dealers,
  snapshots,
  eventList,
}: Props) {
  const [selectedIds, setSelectedIds] = useState<Set<number>>(
    new Set(scorecards.map((s) => s.id))
  );

  // Filter dealers and snapshots based on selection
  const selectedDealers = dealers.filter((d) => selectedIds.has(d.id));
  const filteredSnapshots = snapshots.filter((s) => selectedIds.has(s.dealer_id));
  const filteredEvents = eventList.filter((e) => selectedIds.has(e.dealer_id));



  return (
    <div className="p-6 space-y-6">
      <h1 className="text-white text-xl font-bold">Market Pulse</h1>

      <MarketPulseCards scorecards={scorecards} onSelectionChange={setSelectedIds} />

      {/* 90-day trend chart — filtered by selection */}
      <CompetitorCharts dealers={selectedDealers} snapshots={filteredSnapshots} />

      {/* New listings this week — filtered by selection */}
      <div className="bg-gray-900 border border-gray-800 rounded-lg p-4">
        <h2 className="text-white font-semibold mb-4">
          New Listings (Last 7 Days) — {filteredEvents.filter(e => e.event_type === "added").length} added
        </h2>
        <div className="overflow-x-auto">
          <table className="w-full text-sm text-left text-gray-300">
            <thead className="text-xs text-gray-400 uppercase bg-gray-800 sticky top-0">
              <tr>
                <th className="px-4 py-3">Dealer</th>
                <th className="px-4 py-3">Year</th>
                <th className="px-4 py-3">Make / Model</th>
                <th className="px-4 py-3">Price</th>
                <th className="px-4 py-3">Date</th>
              </tr>
            </thead>
            <tbody>
              {filteredEvents
                .filter(e => e.event_type === "added")
                .sort((a, b) => new Date(b.event_date).getTime() - new Date(a.event_date).getTime())
                .slice(0, 30)
                .map((e) => (
                  <tr key={e.id} className="border-b border-gray-800 hover:bg-gray-800/50">
                    <td className="px-4 py-3 font-semibold text-blue-300">
                      {dealers.find((d) => d.id === e.dealer_id)?.name ?? `Dealer ${e.dealer_id}`}
                    </td>
                    <td className="px-4 py-3">{e.year || "—"}</td>
                    <td className="px-4 py-3 text-gray-200">
                      {e.make && e.model ? `${e.make} ${e.model}` : "—"}
                    </td>
                    <td className="px-4 py-3 font-semibold text-green-400">
                      {e.price_at_listing != null ? `$${e.price_at_listing.toLocaleString()}` : "—"}
                    </td>
                    <td className="px-4 py-3 text-gray-500">{e.event_date.slice(0, 10)}</td>
                  </tr>
                ))}
              {filteredEvents.filter(e => e.event_type === "added").length === 0 && (
                <tr>
                  <td colSpan={5} className="px-4 py-6 text-center text-gray-500">
                    No new listings in selected dealers
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Estimated Sales */}
      <div className="bg-gray-900 border border-gray-800 rounded-lg p-4">
        <h2 className="text-white font-semibold mb-4">
          Estimated Sales (Last 7 Days) — {filteredEvents.filter(e => e.event_type === "removed").length} sold
        </h2>
        <div className="overflow-x-auto">
          <table className="w-full text-sm text-left text-gray-300">
            <thead className="text-xs text-gray-400 uppercase bg-gray-800 sticky top-0">
              <tr>
                <th className="px-4 py-3">Dealer</th>
                <th className="px-4 py-3">Year</th>
                <th className="px-4 py-3">Make / Model</th>
                <th className="px-4 py-3">Listed Price</th>
                <th className="px-4 py-3">Days Listed</th>
                <th className="px-4 py-3">Sold Date</th>
              </tr>
            </thead>
            <tbody>
              {filteredEvents
                .filter(e => e.event_type === "removed")
                .sort((a, b) => new Date(b.event_date).getTime() - new Date(a.event_date).getTime())
                .slice(0, 30)
                .map((e) => {
                  const listedDate = new Date(e.created_at || e.event_date);
                  const soldDate = new Date(e.event_date);
                  const daysListed = Math.ceil((soldDate.getTime() - listedDate.getTime()) / (1000 * 60 * 60 * 24));
                  return (
                    <tr key={e.id} className="border-b border-gray-800 hover:bg-gray-800/50">
                      <td className="px-4 py-3 font-semibold text-red-400">
                        {dealers.find((d) => d.id === e.dealer_id)?.name ?? `Dealer ${e.dealer_id}`}
                      </td>
                      <td className="px-4 py-3">{e.year || "—"}</td>
                      <td className="px-4 py-3 text-gray-200">
                        {e.make && e.model ? `${e.make} ${e.model}` : "—"}
                      </td>
                      <td className="px-4 py-3 font-semibold text-amber-400">
                        {e.price_at_listing != null ? `$${e.price_at_listing.toLocaleString()}` : "—"}
                      </td>
                      <td className="px-4 py-3 text-gray-400">{daysListed}d</td>
                      <td className="px-4 py-3 text-gray-500">{e.event_date.slice(0, 10)}</td>
                    </tr>
                  );
                })}
              {filteredEvents.filter(e => e.event_type === "removed").length === 0 && (
                <tr>
                  <td colSpan={6} className="px-4 py-6 text-center text-gray-500">
                    No sales in selected dealers
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
