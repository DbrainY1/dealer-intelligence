"use client";

import { useState, useEffect } from "react";
import MarketPulseCards, { ScorecardRow } from "./MarketPulseCards";
import CompetitorCharts from "./CompetitorCharts";
import VinHistoryModal from "@/components/VinHistoryModal";
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
  const [selectedVehicleId, setSelectedVehicleId] = useState<number | null>(null);

  // Filter dealers and snapshots based on selection
  const selectedDealers = dealers.filter((d) => selectedIds.has(d.id));
  const filteredSnapshots = snapshots.filter((s) => selectedIds.has(s.dealer_id));
  const filteredEvents = eventList.filter((e) => selectedIds.has(e.to_dealer_id || 0));



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
                <th className="px-4 py-3">Vehicle ID</th>
                <th className="px-4 py-3">List Price</th>
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
                      {dealers.find((d) => d.id === e.to_dealer_id)?.name ?? `Dealer ${e.to_dealer_id}`}
                    </td>
                    <td
                      className="px-4 py-3 font-mono text-amber-400 cursor-pointer hover:underline"
                      onClick={() => setSelectedVehicleId(e.vehicle_id)}
                    >
                      VID-{e.vehicle_id}
                    </td>
                    <td className="px-4 py-3 font-semibold text-green-400">
                      {e.price_at_listing != null ? "$" + e.price_at_listing.toLocaleString() : "—"}
                    </td>
                    <td className="px-4 py-3 text-gray-500">{e.event_date.slice(0, 10)}</td>
                  </tr>
                ))}
              {filteredEvents.filter(e => e.event_type === "added").length === 0 && (
                <tr>
                  <td colSpan={4} className="px-4 py-6 text-center text-gray-500">
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
                <th className="px-4 py-3">Year / Make / Model</th>
                <th className="px-4 py-3">Vehicle ID</th>
                <th className="px-4 py-3">List Price</th>
                <th className="px-4 py-3">Date Sold</th>
              </tr>
            </thead>
            <tbody>
              {filteredEvents
                .filter(e => e.event_type === "removed")
                .sort((a, b) => new Date(b.event_date).getTime() - new Date(a.event_date).getTime())
                .slice(0, 30)
                .map((e) => (
                  <tr key={e.id} className="border-b border-gray-800 hover:bg-gray-800/50">
                    <td className="px-4 py-3 font-semibold text-orange-500">
                      {dealers.find((d) => d.id === e.to_dealer_id)?.name ?? `Dealer ${e.to_dealer_id}`}
                    </td>
                    <td className="px-4 py-3 text-gray-300">
                      <button
                        onClick={() => setSelectedVehicleId(e.vehicle_id)}
                        className="text-orange-400 hover:text-orange-300 hover:underline cursor-pointer"
                      >
                        View Details
                      </button>
                    </td>
                    <td
                      className="px-4 py-3 font-mono text-orange-400 cursor-pointer hover:underline"
                      onClick={() => setSelectedVehicleId(e.vehicle_id)}
                    >
                      VID-{e.vehicle_id}
                    </td>
                    <td className="px-4 py-3 font-semibold text-orange-500">
                      {e.price_at_listing != null ? "$" + e.price_at_listing.toLocaleString() : "—"}
                    </td>
                    <td className="px-4 py-3 text-orange-400">{e.event_date.slice(0, 10)}</td>
                  </tr>
                ))}
              {filteredEvents.filter(e => e.event_type === "removed").length === 0 && (
                <tr>
                  <td colSpan={5} className="px-4 py-6 text-center text-gray-500">
                    No sales in selected dealers
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* VIN History Modal */}
      {selectedVehicleId && (
        <VinHistoryModal
          vehicleId={selectedVehicleId}
          dealers={dealers}
          onClose={() => setSelectedVehicleId(null)}
        />
      )}
    </div>
  );
}
