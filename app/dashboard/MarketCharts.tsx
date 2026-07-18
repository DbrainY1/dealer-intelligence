"use client";
import React from "react";
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
} from "recharts";
import type { Dealer } from "@/types";
import { useRouter } from "next/navigation";
import { useState } from "react";

export interface DailySoldVehicle {
  year: number | null;
  make: string | null;
  model: string | null;
  trim: string | null;
  mileage: number | null;
  vin: string | null;
  price: number | null;
  date: string;
}

interface DealerRow {
  name: string;
  count: number;
  sold: number;
  added: number;
  transferred: number;
  dailySold: number;
  dailySoldVehicles: DailySoldVehicle[];
}

interface Props {
  byDealer: DealerRow[];
  dealers: Dealer[];
  /** Cutoff-aware header for the sold column, e.g. "Sold Since Jul 11".
   *  Falls back to "MTD Sold" when the month is not a canonical projection. */
  soldColumnLabel?: string;
  /** Cutoff-aware title for the velocity chart, e.g. "Sales Velocity (Since Jul 11)". */
  velocityTitle?: string;
}

export default function MarketCharts({ byDealer, dealers, soldColumnLabel, velocityTitle }: Props) {
  const router = useRouter();
  // Inline expansion: which dealer's Daily Sold vehicle list is open.
  const [expandedDealer, setExpandedDealer] = useState<string | null>(null);

  return (
    <div className="space-y-6">
      <div className="bg-gray-900 border border-gray-800 rounded-lg p-4">
        <p className="text-gray-400 text-sm mb-3">Inventory Count by Dealer</p>
        <ResponsiveContainer width="100%" height={220}>
          <BarChart data={byDealer}>
            <CartesianGrid strokeDasharray="3 3" stroke="#374151" />
            <XAxis dataKey="name" tick={{ fill: "#9ca3af", fontSize: 11 }} />
            <YAxis tick={{ fill: "#9ca3af", fontSize: 11 }} />
            <Tooltip contentStyle={{ backgroundColor: "#111827", border: "1px solid #374151", color: "#fff" }} />
            <Bar dataKey="count" fill="#3b82f6" />
          </BarChart>
        </ResponsiveContainer>
      </div>
      <div className="bg-gray-900 border border-gray-800 rounded-lg p-4">
        <p className="text-gray-400 text-sm mb-3">{velocityTitle ?? "MTD Sales Velocity"}</p>
        <ResponsiveContainer width="100%" height={220}>
          <BarChart data={byDealer}>
            <CartesianGrid strokeDasharray="3 3" stroke="#374151" />
            <XAxis dataKey="name" tick={{ fill: "#9ca3af", fontSize: 11 }} />
            <YAxis tick={{ fill: "#9ca3af", fontSize: 11 }} />
            <Tooltip contentStyle={{ backgroundColor: "#111827", border: "1px solid #374151", color: "#fff" }} />
            <Bar dataKey="sold" fill="#f59e0b" />
          </BarChart>
        </ResponsiveContainer>
      </div>
      <div className="bg-gray-900 border border-gray-800 rounded-lg overflow-hidden">
        <table className="w-full text-sm text-left text-gray-300">
          <thead className="text-xs text-gray-400 uppercase bg-gray-800">
            <tr>
              <th className="px-4 py-3">Dealer</th>
              <th className="px-4 py-3">In Stock</th>
              <th className="px-4 py-3">Daily Sold</th>
              <th className="px-4 py-3">{soldColumnLabel ?? "MTD Sold"}</th>
              <th className="px-4 py-3">MTD Added</th>
              <th className="px-4 py-3">MTD Transferred</th>
              <th className="px-4 py-3"></th>
            </tr>
          </thead>
          <tbody>
            {byDealer.map((d) => {
              const dealer = dealers.find((x) => x.name === d.name);
              const isExpanded = expandedDealer === d.name;
              return (
                <React.Fragment key={d.name}>
                  <tr
                    className="border-b border-gray-800 hover:bg-gray-800 cursor-pointer transition-colors"
                    onClick={() => dealer && router.push(`/dashboard/dealer/${dealer.id}`)}
                  >
                    <td className="px-4 py-3 text-white font-medium">{d.name}</td>
                    <td className="px-4 py-3">{d.count}</td>
                    {/* Daily Sold is expandable; stop propagation so the row's
                        dealer drill-down navigation is preserved. */}
                    <td
                      className={`px-4 py-3 ${d.dailySold > 0 ? "text-orange-400 cursor-pointer hover:text-orange-300" : "text-gray-500"}`}
                      onClick={(e) => {
                        e.stopPropagation();
                        if (d.dailySold > 0) setExpandedDealer(isExpanded ? null : d.name);
                      }}
                    >
                      {d.dailySold}
                      {d.dailySold > 0 && <span className="ml-1 text-xs">{isExpanded ? "▾" : "▸"}</span>}
                    </td>
                    <td className="px-4 py-3">{d.sold}</td>
                    <td className="px-4 py-3 text-green-400">{d.added}</td>
                    <td className="px-4 py-3 text-yellow-400">{d.transferred}</td>
                    <td className="px-4 py-3 text-gray-500 text-xs">→</td>
                  </tr>
                  {isExpanded && (
                    <tr className="bg-gray-950/60 border-b border-gray-800">
                      <td colSpan={7} className="px-4 py-3">
                        <div className="overflow-x-auto">
                          <table className="w-full text-xs text-left text-gray-300">
                            <thead className="text-gray-400 uppercase">
                              <tr>
                                <th className="px-3 py-2">Dealer</th>
                                <th className="px-3 py-2">Year</th>
                                <th className="px-3 py-2">Make</th>
                                <th className="px-3 py-2">Model</th>
                                <th className="px-3 py-2">Trim</th>
                                <th className="px-3 py-2">Mileage</th>
                                <th className="px-3 py-2">VIN</th>
                                <th className="px-3 py-2">Price</th>
                                <th className="px-3 py-2">Date</th>
                              </tr>
                            </thead>
                            <tbody>
                              {d.dailySoldVehicles.map((v, i) => (
                                <tr key={`${v.vin ?? "veh"}-${i}`} className="border-t border-gray-800">
                                  <td className="px-3 py-2 text-white">{d.name}</td>
                                  <td className="px-3 py-2">{v.year ?? "—"}</td>
                                  <td className="px-3 py-2">{v.make ?? "—"}</td>
                                  <td className="px-3 py-2">{v.model ?? "—"}</td>
                                  <td className="px-3 py-2">{v.trim ?? "—"}</td>
                                  <td className="px-3 py-2">{v.mileage != null ? v.mileage.toLocaleString() : "—"}</td>
                                  <td className="px-3 py-2 font-mono">{v.vin ?? "—"}</td>
                                  <td className="px-3 py-2">{v.price != null ? "$" + v.price.toLocaleString() : "—"}</td>
                                  <td className="px-3 py-2">{v.date.slice(0, 10)}</td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        </div>
                      </td>
                    </tr>
                  )}
                </React.Fragment>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
