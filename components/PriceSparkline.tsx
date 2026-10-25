import type { PriceTrend } from "@/lib/price-trend";

export interface PriceSparklineProps {
  /**
   * Pre-computed 7-day trend for this dealer, or null when the dealer has no
   * priced observation in the window.
   *
   * This used to be a client component that fetched
   * /api/dealer/<id>/price-trend?days=7 on mount, once per dealer card. The
   * figures are now computed server-side in one set-based read and passed in,
   * so the page makes no per-dealer requests at all.
   */
  trend: PriceTrend | null;
  className?: string;
}

export default function PriceSparkline({ trend, className = "" }: PriceSparklineProps) {
  if (!trend || trend.dailyAverages.length === 0) {
    return <p className={`text-xs text-gray-600 text-center py-2 ${className}`}>No data</p>;
  }

  return (
    <div className={`text-xs text-gray-400 flex justify-between px-1 ${className}`}>
      <span>
        Avg: <span className="text-white font-semibold">${trend.avg.toLocaleString()}</span>
      </span>
      <span>
        Range:{" "}
        <span className="text-white font-semibold">
          ${trend.min.toLocaleString()} — ${trend.max.toLocaleString()}
        </span>
      </span>
    </div>
  );
}
