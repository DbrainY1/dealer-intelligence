"use client";

import { useEffect, useState } from "react";
import type { InventoryEvent, Dealer } from "@/types";

interface VinHistoryModalProps {
  vehicleId: number;
  dealers: Dealer[];
  onClose: () => void;
}

interface VehicleData {
  year: number | null;
  make: string | null;
  model: string | null;
  mileage: number | null;
  vin: string | null;
}

export default function VinHistoryModal({ vehicleId, dealers, onClose }: VinHistoryModalProps) {
  const [events, setEvents] = useState<InventoryEvent[]>([]);
  const [vehicle, setVehicle] = useState<VehicleData>({
    year: null,
    make: null,
    model: null,
    mileage: null,
    vin: null,
  });
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const fetchHistory = async () => {
      try {
        const res = await fetch(`/api/vehicle/${vehicleId}/history`, { cache: "no-store" });
        if (!res.ok) throw new Error("Failed to fetch");
        const data = await res.json();
        setEvents(data.events || []);
        setVehicle(data.vehicle || {});
      } catch (err) {
        console.error("VIN history error:", err);
      } finally {
        setLoading(false);
      }
    };
    fetchHistory();
  }, [vehicleId]);

  if (loading) return <div className="p-4 text-gray-400">Loading...</div>;
  if (events.length === 0) return <div className="p-4 text-gray-400">No history found</div>;

  // Sort by date ascending (oldest first)
  const sorted = [...events].sort((a, b) => new Date(a.event_date).getTime() - new Date(b.event_date).getTime());

  // Calculate days on market
  const firstDate = new Date(sorted[0]?.event_date || new Date());
  const lastDate = new Date(sorted[sorted.length - 1]?.event_date || new Date());
  const daysOnMarket = Math.ceil((lastDate.getTime() - firstDate.getTime()) / (1000 * 60 * 60 * 24));

  return (
    <div
      className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4"
      onClick={onClose}
    >
      <div
        className="bg-orange-950/30 border-2 border-orange-500 rounded-lg max-w-4xl w-full max-h-[85vh] overflow-y-auto"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="sticky top-0 bg-orange-950/40 border-b-2 border-orange-500 p-4 flex items-start justify-between gap-4">
          <div className="flex-1">
            <div className="flex items-baseline gap-3 flex-wrap mb-2">
              <span className="text-orange-300 font-bold text-lg">{vehicle.year}</span>
              <span className="text-orange-200 text-lg font-semibold">{vehicle.make}</span>
              <span className="text-orange-200 text-lg font-semibold">{vehicle.model}</span>
              {vehicle.mileage && (
                <span className="text-orange-300 text-sm font-semibold">
                  {vehicle.mileage.toLocaleString()} mi
                </span>
              )}
            </div>
            <p className="text-orange-100 text-xs font-mono">{vehicle.vin || `VID-${vehicleId}`}</p>
          </div>
          <button
            onClick={onClose}
            className="text-orange-300 hover:text-orange-100 text-2xl leading-none"
          >
            ×
          </button>
        </div>

        {/* Summary */}
        <div className="p-4 bg-orange-950/50 border-b-2 border-orange-500">
          <div className="grid grid-cols-3 gap-4 text-sm">
            <div>
              <p className="text-orange-200">Days on Market</p>
              <p className="text-orange-400 font-bold text-lg">{daysOnMarket}d</p>
            </div>
            <div>
              <p className="text-orange-200">Total Events</p>
              <p className="text-orange-400 font-bold text-lg">{events.length}</p>
            </div>
            <div>
              <p className="text-orange-200">Status</p>
              <p className={`font-bold text-lg ${
                events.some(e => e.event_type === "removed") ? "text-orange-600" : "text-orange-400"
              }`}>
                {events.some(e => e.event_type === "removed") ? "Sold" : "Active"}
              </p>
            </div>
          </div>
        </div>

        {/* Timeline */}
        <div className="p-4 space-y-3">
          {sorted.map((event, idx) => {
            const dealer = dealers.find(d => d.id === event.dealer_id);
            const isRemoved = event.event_type === "removed";
            const isAdded = event.event_type === "added";
            const isTransfer = event.from_dealer_id && event.from_dealer_id !== event.dealer_id;

            let icon = "📍";
            let color = "text-blue-400";
            let bgColor = "bg-blue-900/20";
            if (isRemoved) {
              icon = "✓";
              color = "text-red-400";
              bgColor = "bg-red-900/20";
            } else if (isAdded) {
              icon = "+";
              color = "text-green-400";
              bgColor = "bg-green-900/20";
            } else if (event.event_type === "price_changed") {
              icon = "$";
              color = "text-amber-400";
              bgColor = "bg-amber-900/20";
            }

            return (
              <div key={event.id} className="flex gap-3">
                {/* Timeline dot */}
                <div className="flex flex-col items-center">
                  <div className={`w-8 h-8 rounded-full ${bgColor} flex items-center justify-center ${color} font-bold text-xs`}>
                    {icon}
                  </div>
                  {idx < sorted.length - 1 && <div className="w-0.5 h-8 bg-gray-700 my-1" />}
                </div>

                {/* Event details */}
                <div className="flex-1 pb-2">
                  <div className="flex items-start justify-between">
                    <div>
                      <p className="text-white font-semibold">
                        {isRemoved && "Removed (Sold)"}
                        {isAdded && "Added to Inventory"}
                        {event.event_type === "price_changed" && "Price Changed"}
                        {isTransfer && ` (Transferred)`}
                      </p>
                      <p className="text-gray-400 text-sm">
                        {dealer ? dealer.name : `Dealer ${event.dealer_id}`}
                      </p>
                    </div>
                    <p className="text-gray-500 text-sm">{event.event_date.slice(0, 10)}</p>
                  </div>

                  {/* Price info */}
                  {event.price_at_listing != null && (
                    <p className="text-green-400 text-sm font-semibold mt-1">
                      List Price: ${event.price_at_listing.toLocaleString()}
                    </p>
                  )}
                  {event.event_type === "price_changed" && event.new_price != null && (
                    <p className="text-amber-400 text-sm mt-1">
                      New Price: ${event.new_price.toLocaleString()}
                      {event.old_price != null && (
                        <span className="text-gray-500 ml-2">
                          (was ${event.old_price.toLocaleString()})
                        </span>
                      )}
                    </p>
                  )}

                  {/* Mileage info */}
                  {event.last_seen_mileage != null && (
                    <p className="text-gray-400 text-sm mt-1">
                      Mileage: {event.last_seen_mileage.toLocaleString()} miles
                    </p>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
