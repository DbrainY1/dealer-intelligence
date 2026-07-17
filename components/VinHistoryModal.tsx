"use client";

import { useEffect, useState } from "react";
import type { InventoryEvent, Dealer } from "@/types";
import {
  buildTimeline,
  computeDaysOnMarket,
  computeLifecycle,
  effectiveDealerId,
  todayInMarketTz,
  type DisplayTone,
  type EffectiveStatus,
} from "@/lib/vin-history";

interface VinHistoryModalProps {
  vehicleId: number;
  dealers: Dealer[];
  onClose: () => void;
  /** Caller context: the surface that opened the modal shows this vehicle in
   *  today's current inventory. Used only as a fallback when event history
   *  alone cannot answer the status question. */
  inCurrentInventory?: boolean;
}

interface VehicleData {
  year: number | null;
  make: string | null;
  model: string | null;
  mileage: number | null;
  vin: string | null;
}

const TONE_STYLES: Record<DisplayTone, { text: string; bg: string }> = {
  positive: { text: "text-green-400", bg: "bg-green-900/20" },
  danger: { text: "text-red-400", bg: "bg-red-900/20" },
  warning: { text: "text-amber-400", bg: "bg-amber-900/20" },
  info: { text: "text-blue-400", bg: "bg-blue-900/20" },
  muted: { text: "text-gray-500", bg: "bg-gray-800/40" },
  neutral: { text: "text-blue-400", bg: "bg-blue-900/20" },
};

function statusPill(status: EffectiveStatus): { label: string; className: string } {
  switch (status.kind) {
    case "sold":
      return { label: "Sold", className: "text-red-400" };
    case "transferred":
      return { label: "Transferred", className: "text-blue-400" };
    case "pending_departure":
      return { label: "Pending Departure", className: "text-amber-400" };
    case "active":
      return { label: "Active", className: "text-orange-400" };
    default:
      return { label: "Unconfirmed", className: "text-gray-400" };
  }
}

export default function VinHistoryModal({
  vehicleId,
  dealers,
  onClose,
  inCurrentInventory,
}: VinHistoryModalProps) {
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

  // Canonical-aware lifecycle state (legacy sold/removed never decide status).
  const lifecycleOpts = { inCurrentInventory };
  const { status } = computeLifecycle(events, lifecycleOpts);
  const pill = statusPill(status);

  // Days on Market = current stint → today (active/pending) or → canonical
  // departure date (sold/transferred), on the market calendar (Pacific).
  const daysOnMarket = computeDaysOnMarket(events, todayInMarketTz(), lifecycleOpts);

  // Display timeline: duplicate-ADDED churn collapsed, resolved outcomes carry
  // their linked pending detection nested. All raw rows stay in the payload.
  const timeline = buildTimeline(events);

  const dealerName = (id: number | null | undefined) =>
    dealers.find((d) => d.id === id)?.name ?? null;

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
              <p className="text-orange-400 font-bold text-lg">
                {daysOnMarket != null ? `${daysOnMarket}d` : "—"}
              </p>
            </div>
            <div>
              <p className="text-orange-200">Total Events</p>
              <p className="text-orange-400 font-bold text-lg">{events.length}</p>
            </div>
            <div>
              <p className="text-orange-200">Status</p>
              <p className={`font-bold text-lg ${pill.className}`}>{pill.label}</p>
            </div>
          </div>
        </div>

        {/* Timeline */}
        <div className="p-4 space-y-3">
          {timeline.map((item, idx) => {
            const event = item.event;
            const { label, tone, icon, demoted, struck } = item.display;
            const toneStyle = TONE_STYLES[tone];

            const fromName = dealerName(event.from_dealer_id);
            const toName = dealerName(event.to_dealer_id);
            let dealerLabel = "Dealer unknown";
            if (event.event_type === "transferred" && fromName && toName) {
              dealerLabel = `${fromName} → ${toName}`;
            } else {
              dealerLabel = dealerName(effectiveDealerId(event)) ?? "Dealer unknown";
            }

            return (
              <div key={event.id} className={`flex gap-3 ${demoted ? "opacity-60" : ""}`}>
                {/* Timeline dot */}
                <div className="flex flex-col items-center">
                  <div
                    className={`w-8 h-8 rounded-full ${toneStyle.bg} flex items-center justify-center ${toneStyle.text} font-bold text-xs`}
                  >
                    {icon}
                  </div>
                  {idx < timeline.length - 1 && <div className="w-0.5 h-8 bg-gray-700 my-1" />}
                </div>

                {/* Event details */}
                <div className="flex-1 pb-2">
                  <div className="flex items-start justify-between">
                    <div>
                      <p
                        className={`font-semibold ${demoted ? "text-gray-400" : "text-white"} ${
                          struck ? "line-through" : ""
                        }`}
                      >
                        {label}
                      </p>
                      <p className="text-gray-400 text-sm">{dealerLabel}</p>
                      {item.seenAgain.length > 0 && (
                        <p
                          className="text-gray-500 text-xs mt-0.5"
                          title={item.seenAgain
                            .map((s) => s.event_date.slice(0, 10))
                            .join(", ")}
                        >
                          Seen again ×{item.seenAgain.length}
                        </p>
                      )}
                      {item.nestedDetection && (
                        <p className="text-gray-500 text-xs mt-0.5">
                          From pending departure detected{" "}
                          {item.nestedDetection.event_date.slice(0, 10)}
                        </p>
                      )}
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
