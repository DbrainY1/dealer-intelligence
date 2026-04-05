"use client";

import { useState, useEffect } from "react";
import MarketPulseCards, { ScorecardRow } from "./MarketPulseCards";
import CompetitorCharts from "./CompetitorCharts";
import VinHistoryModal from "@/components/VinHistoryModal";
import type { Dealer, InventorySnapshot, InventoryEvent } from "@/types";

interface VehicleInfo {
  year: number | null;
  make: string | null;
  model: string | null;
  mileage: number | null;
  vin: string | null;
}

interface Props {
  scorecards: ScorecardRow[];
  dealers: Dealer[];
  snapshots: InventorySnapshot[];
  eventList: InventoryEvent[];
  vehicleMap?: Record<number, VehicleInfo>;
}

export default function CompetitorsPageClient({
  scorecards,
  dealers,
  snapshots,
  eventList,
  vehicleMap = {},
}: Props) {
  const [selectedIds, setSelectedIds] = useState<Set<number>>(
    new Set(scorecards.map((s) => s.id))
  );
  const [selectedVehicleId, setSelectedVehicleId] = useState<number | null>(null);
  const [sortColumn, setSortColumn] = useState<string | null>(null);
  const [sortDirection, setSortDirection] = useState<"asc" | "desc">("asc");

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
                <th className="px-4 py-3 cursor-pointer hover:text-orange-400" onClick={() => {
                  if (sortColumn === "dealer") setSortDirection(sortDirection === "asc" ? "desc" : "asc");
                  else { setSortColumn("dealer"); setSortDirection("asc"); }
                }}>
                  Dealer {sortColumn === "dealer" && (sortDirection === "asc" ? "↑" : "↓")}
                </th>
                <th className="px-4 py-3 cursor-pointer hover:text-orange-400" onClick={() => {
                  if (sortColumn === "year") setSortDirection(sortDirection === "asc" ? "desc" : "asc");
                  else { setSortColumn("year"); setSortDirection("asc"); }
                }}>
                  Year {sortColumn === "year" && (sortDirection === "asc" ? "↑" : "↓")}
                </th>
                <th className="px-4 py-3 cursor-pointer hover:text-orange-400" onClick={() => {
                  if (sortColumn === "make") setSortDirection(sortDirection === "asc" ? "desc" : "asc");
                  else { setSortColumn("make"); setSortDirection("asc"); }
                }}>
                  Make {sortColumn === "make" && (sortDirection === "asc" ? "↑" : "↓")}
                </th>
                <th className="px-4 py-3 cursor-pointer hover:text-orange-400" onClick={() => {
                  if (sortColumn === "model") setSortDirection(sortDirection === "asc" ? "desc" : "asc");
                  else { setSortColumn("model"); setSortDirection("asc"); }
                }}>
                  Model {sortColumn === "model" && (sortDirection === "asc" ? "↑" : "↓")}
                </th>
                <th className="px-4 py-3 cursor-pointer hover:text-orange-400" onClick={() => {
                  if (sortColumn === "mileage") setSortDirection(sortDirection === "asc" ? "desc" : "asc");
                  else { setSortColumn("mileage"); setSortDirection("asc"); }
                }}>
                  Mileage {sortColumn === "mileage" && (sortDirection === "asc" ? "↑" : "↓")}
                </th>
                <th className="px-4 py-3">VIN#</th>
                <th className="px-4 py-3 cursor-pointer hover:text-orange-400" onClick={() => {
                  if (sortColumn === "price") setSortDirection(sortDirection === "asc" ? "desc" : "asc");
                  else { setSortColumn("price"); setSortDirection("asc"); }
                }}>
                  List Price {sortColumn === "price" && (sortDirection === "asc" ? "↑" : "↓")}
                </th>
                <th className="px-4 py-3 cursor-pointer hover:text-orange-400" onClick={() => {
                  if (sortColumn === "date") setSortDirection(sortDirection === "asc" ? "desc" : "asc");
                  else { setSortColumn("date"); setSortDirection("asc"); }
                }}>
                  Date Sold {sortColumn === "date" && (sortDirection === "asc" ? "↑" : "↓")}
                </th>
              </tr>
            </thead>
            <tbody>
              {filteredEvents
                .filter(e => e.event_type === "removed")
                .sort((a, b) => {
                  // Apply custom sort if a column is selected
                  if (sortColumn) {
                    let aVal: any, bVal: any;
                    const vehA = vehicleMap[a.vehicle_id];
                    const vehB = vehicleMap[b.vehicle_id];
                    
                    switch (sortColumn) {
                      case "dealer":
                        aVal = dealers.find(d => d.id === a.to_dealer_id)?.name || "";
                        bVal = dealers.find(d => d.id === b.to_dealer_id)?.name || "";
                        break;
                      case "year":
                        aVal = vehA?.year || 0;
                        bVal = vehB?.year || 0;
                        break;
                      case "make":
                        aVal = vehA?.make || "";
                        bVal = vehB?.make || "";
                        break;
                      case "model":
                        aVal = vehA?.model || "";
                        bVal = vehB?.model || "";
                        break;
                      case "mileage":
                        aVal = vehA?.mileage || 0;
                        bVal = vehB?.mileage || 0;
                        break;
                      case "price":
                        aVal = a.price_at_listing || a.last_seen_price || 0;
                        bVal = b.price_at_listing || b.last_seen_price || 0;
                        break;
                      case "date":
                        aVal = new Date(a.event_date).getTime();
                        bVal = new Date(b.event_date).getTime();
                        break;
                      default:
                        return 0;
                    }
                    
                    if (typeof aVal === "string") {
                      return sortDirection === "asc" ? aVal.localeCompare(bVal) : bVal.localeCompare(aVal);
                    } else {
                      return sortDirection === "asc" ? aVal - bVal : bVal - aVal;
                    }
                  }
                  
                  // Default sort by date descending
                  return new Date(b.event_date).getTime() - new Date(a.event_date).getTime();
                })
                .slice(0, 30)
                .map((e) => {
                  const veh = vehicleMap[e.vehicle_id];
                  // Parse and format date: YYYY-MM-DD → DD/MM/YYYY
                  const [year, month, day] = e.event_date.split("-");
                  const formattedDate = `${day}/${month}/${year}`;
                  return (
                    <tr
                      key={e.id}
                      className="border-b border-gray-800 hover:bg-gray-800/50 cursor-pointer"
                      onClick={() => setSelectedVehicleId(e.vehicle_id)}
                    >
                      <td className="px-4 py-3 font-semibold text-orange-500">
                        {dealers.find((d) => d.id === e.to_dealer_id)?.name ?? `Dealer ${e.to_dealer_id}`}
                      </td>
                      <td className="px-4 py-3 text-orange-400">{veh?.year || "—"}</td>
                      <td className="px-4 py-3 text-orange-400">{veh?.make || "—"}</td>
                      <td className="px-4 py-3 text-orange-400">{veh?.model || "—"}</td>
                      <td className="px-4 py-3 text-orange-400">
                        {veh?.mileage ? veh.mileage.toLocaleString() : "—"}
                      </td>
                      <td className="px-4 py-3 font-mono text-orange-400 text-xs">{veh?.vin || "—"}</td>
                      <td className="px-4 py-3 font-semibold text-orange-500">
                        {e.price_at_listing != null ? "$" + e.price_at_listing.toLocaleString() : e.last_seen_price != null ? "$" + e.last_seen_price.toLocaleString() : "—"}
                      </td>
                      <td className="px-4 py-3 text-orange-400">{formattedDate}</td>
                    </tr>
                  );
                })}
              {filteredEvents.filter(e => e.event_type === "removed").length === 0 && (
                <tr>
                  <td colSpan={8} className="px-4 py-6 text-center text-gray-500">
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
