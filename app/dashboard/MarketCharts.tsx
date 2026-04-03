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
import { useState } from "react";
import { useRouter } from "next/navigation";

interface DealerRow {
  name: string;
  count: number;
  sold: number;
}

interface Props {
  byDealer: DealerRow[];
  dealers: Dealer[];
}

export default function MarketCharts({ byDealer, dealers }: Props) {
  const router = useRouter();
  const [expanded, setExpanded] = useState<string | null>(null);

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
        <p className="text-gray-400 text-sm mb-3">MTD Sales Velocity</p>
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
              <th className="px-4 py-3">MTD Sold</th>
              <th className="px-4 py-3"></th>
            </tr>
          </thead>
          <tbody>
            {byDealer.map((d) => {
              const dealer = dealers.find((x) => x.name === d.name);
              return (
                <React.Fragment key={d.name}>
                  <tr
                    className="border-b border-gray-800 hover:bg-gray-800 cursor-pointer"
                    onClick={() => setExpanded(expanded === d.name ? null : d.name)}
                  >
                    <td className="px-4 py-3 text-white">{d.name}</td>
                    <td className="px-4 py-3">{d.count}</td>
                    <td className="px-4 py-3">{d.sold}</td>
                    <td className="px-4 py-3 text-gray-500 text-xs">{expanded === d.name ? "▲" : "▼"}</td>
                  </tr>
                  {expanded === d.name && dealer && (
                    <tr className="bg-gray-800/50">
                      <td colSpan={4} className="px-4 py-3">
                        <button
                          className="text-blue-400 text-xs hover:underline"
                          onClick={() => router.push(`/dashboard/dealer/${dealer.id}`)}
                        >
                          View dealer detail →
                        </button>
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
