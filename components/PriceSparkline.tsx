"use client";

import { LineChart, Line, ResponsiveContainer, Tooltip } from "recharts";
import { useEffect, useState } from "react";

interface SparklineData {
  date: string;
  price: number;
}

export interface PriceSparklineProps {
  dealerId: number;
  className?: string;
}

export default function PriceSparkline({ dealerId, className = "" }: PriceSparklineProps) {
  const [data, setData] = useState<SparklineData[]>([]);
  const [loading, setLoading] = useState(true);
  const [trend, setTrend] = useState<"up" | "down" | "flat">("flat");

  useEffect(() => {
    const fetchData = async () => {
      try {
        const res = await fetch(
          `/api/dealer/${dealerId}/price-trend?days=7`,
          { cache: "no-store" }
        );
        if (!res.ok) throw new Error("Failed to fetch price trend");
        const json = await res.json();
        setData(json.data || []);

        // Calculate trend
        if (json.data && json.data.length >= 2) {
          const first = json.data[0].price;
          const last = json.data[json.data.length - 1].price;
          if (last > first) setTrend("up");
          else if (last < first) setTrend("down");
          else setTrend("flat");
        }
      } catch (err) {
        console.error("PriceSparkline error:", err);
      } finally {
        setLoading(false);
      }
    };

    fetchData();
  }, [dealerId]);

  if (loading) return <div className={`h-10 bg-gray-800 rounded animate-pulse ${className}`} />;
  if (!data || data.length === 0)
    return <p className={`text-xs text-gray-600 text-center py-2 ${className}`}>No data</p>;

  const minPrice = Math.min(...data.map((d) => d.price));
  const maxPrice = Math.max(...data.map((d) => d.price));
  const avgPrice = Math.round(data.reduce((sum, d) => sum + d.price, 0) / data.length);
  const lastPrice = data[data.length - 1].price;

  const color =
    trend === "up" ? "#ef4444" : trend === "down" ? "#22c55e" : "#9ca3af";

  return (
    <div className={className}>
      <ResponsiveContainer width="100%" height={40}>
        <LineChart data={data} margin={{ top: 0, right: 0, left: 0, bottom: 0 }}>
          <Tooltip
            contentStyle={{
              background: "#1f2937",
              border: "1px solid #374151",
              borderRadius: "4px",
              padding: "6px",
              fontSize: "11px",
            }}
            formatter={(value: any) => (value ? `$${value.toLocaleString()}` : "")}
            labelFormatter={(label: any) => String(label)}
          />
          <Line
            type="monotone"
            dataKey="price"
            stroke={color}
            dot={false}
            isAnimationActive={false}
            strokeWidth={1.5}
          />
        </LineChart>
      </ResponsiveContainer>
      <div className="text-xs text-gray-400 mt-1 flex justify-between px-1">
        <span>
          Avg: <span className="text-white font-semibold">${avgPrice.toLocaleString()}</span>
        </span>
        <span>
          Range: <span className="text-white font-semibold">${minPrice.toLocaleString()} — ${maxPrice.toLocaleString()}</span>
        </span>
      </div>
    </div>
  );
}
