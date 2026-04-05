"use client";

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

  return (
    <div className={`text-xs text-gray-400 flex justify-between px-1 ${className}`}>
      <span>
        Avg: <span className="text-white font-semibold">${avgPrice.toLocaleString()}</span>
      </span>
      <span>
        Range: <span className="text-white font-semibold">${minPrice.toLocaleString()} — ${maxPrice.toLocaleString()}</span>
      </span>
    </div>
  );
}
