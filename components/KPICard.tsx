import Link from "next/link";

interface KPICardProps {
  label: string;
  value: string | number;
  trend?: "up" | "down" | "neutral";
  trendValue?: string;
  // Optional drill-down. Without it the card renders exactly as before.
  href?: string;
}

export default function KPICard({ label, value, trend, trendValue, href }: KPICardProps) {
  const trendColor =
    trend === "up"
      ? "text-green-400"
      : trend === "down"
      ? "text-red-400"
      : "text-gray-400";
  const trendIcon = trend === "up" ? "↑" : trend === "down" ? "↓" : "→";

  const body = (
    <>
      <p className="text-gray-400 text-sm mb-1">{label}</p>
      <p className="text-white text-2xl font-bold">{value}</p>
      {trendValue && (
        <p className={`text-sm mt-1 ${trendColor}`}>
          {trendIcon} {trendValue}
        </p>
      )}
    </>
  );

  if (!href) {
    return <div className="bg-gray-900 rounded-lg p-4 border border-gray-800">{body}</div>;
  }

  return (
    <Link
      href={href}
      aria-label={`${label}: ${value}. View details`}
      className="group block bg-gray-900 rounded-lg p-4 border border-gray-800 transition-colors hover:border-gray-600 hover:bg-gray-800/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-400 focus-visible:ring-offset-2 focus-visible:ring-offset-gray-950"
    >
      {body}
      <p className="mt-1 text-xs text-gray-500 group-hover:text-amber-300 group-focus-visible:text-amber-300">View →</p>
    </Link>
  );
}
