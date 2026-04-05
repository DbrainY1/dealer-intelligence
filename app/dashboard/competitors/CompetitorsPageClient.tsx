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
        <h2 className="text-white font-semibold mb-4">New Listings (Last 7 Days)</h2>
        <table className="w-full text-sm text-left text-gray-300">
          <thead className="text-xs text-gray-400 uppercase bg-gray-800">
            <tr>
              <th className="px-4 py-3">VIN</th>
              <th className="px-4 py-3">Dealer</th>
              <th className="px-4 py-3">Date</th>
              <th className="px-4 py-3">Price</th>
            </tr>
          </thead>
          <tbody>
            {filteredEvents.slice(0, 20).map((e) => (
              <tr key={e.id} className="border-b border-gray-800">
                <td className="px-4 py-3 font-mono text-amber-400">VID-{e.vehicle_id}</td>
                <td className="px-4 py-3">
                  {dealers.find((d) => d.id === e.dealer_id)?.name ?? `Dealer ${e.dealer_id}`}
                </td>
                <td className="px-4 py-3">{e.event_date.slice(0, 10)}</td>
                <td className="px-4 py-3">
                  {e.price_at_listing != null ? `$${e.price_at_listing.toLocaleString()}` : "—"}
                </td>
              </tr>
            ))}
            {filteredEvents.length === 0 && (
              <tr>
                <td colSpan={4} className="px-4 py-6 text-center text-gray-500">
                  No new listings
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {/* Estimated Sales — placeholder */}
      <div className="bg-gray-900 border border-amber-900/40 rounded-lg p-4">
        <h2 className="text-white font-semibold mb-2">Estimated Sales (Restricted)</h2>
        <p className="text-gray-400 text-sm">Visible to owners and developers only.</p>
      </div>
    </div>
  );
}
