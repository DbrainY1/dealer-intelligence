import Link from "next/link";
import {
  SCOPE_DESCRIPTION,
  type Freshness,
  type MarketScope,
} from "@/lib/freshness";

/**
 * Market scope toggle plus the cohort summary.
 *
 * Server-rendered links rather than client state: switching scope re-renders
 * the page from the server, so the dealers listed and the totals shown always
 * come from the same load. There is no client-side filtering that could drift
 * out of sync with the numbers.
 */

const FRESHNESS_DOT: Record<Freshness, string> = {
  current: "bg-emerald-400",
  recent: "bg-blue-400",
  stale: "bg-amber-400",
  historic: "bg-gray-500",
};

const FRESHNESS_TEXT: Record<Freshness, string> = {
  current: "text-emerald-300",
  recent: "text-blue-300",
  stale: "text-amber-300",
  historic: "text-gray-400",
};

export function FreshnessBadge({
  freshness,
  ageDays,
}: {
  freshness: Freshness;
  ageDays: number | null;
}) {
  const age =
    ageDays === null
      ? "no capture in 14+ days"
      : ageDays === 0
      ? "today"
      : ageDays === 1
      ? "1 day ago"
      : `${ageDays} days ago`;
  return (
    <span className={`inline-flex items-center gap-1.5 text-xs ${FRESHNESS_TEXT[freshness]}`}>
      <span className={`w-1.5 h-1.5 rounded-full ${FRESHNESS_DOT[freshness]}`} />
      {age}
    </span>
  );
}

export interface ExcludedDealerSummary {
  id: number;
  name: string;
  lcd: string | null;
  ageDays: number | null;
  freshness: Freshness;
}

export default function MarketScopeBar({
  scope,
  basePath,
  cohortCount,
  monitoredCount,
  excluded,
}: {
  scope: MarketScope;
  /** Route the toggle links point at, e.g. "/dashboard". */
  basePath: string;
  cohortCount: number;
  monitoredCount: number;
  excluded: ExcludedDealerSummary[];
}) {
  const options: { value: MarketScope; label: string; href: string }[] = [
    { value: "current_recent", label: "Current + Recent", href: basePath },
    { value: "current", label: "Current only", href: `${basePath}?scope=current` },
  ];

  return (
    <div className="bg-gray-900 border border-gray-800 rounded-lg p-3 flex flex-wrap items-center gap-x-6 gap-y-3">
      <div className="flex items-center gap-3">
        <span className="text-gray-500 text-xs font-mono uppercase tracking-widest shrink-0">
          Market scope
        </span>
        <div className="flex gap-1">
          {options.map((o) => {
            const active = o.value === scope;
            return (
              <Link
                key={o.value}
                href={o.href}
                scroll={false}
                aria-current={active ? "true" : undefined}
                className={`px-3 py-1.5 rounded-lg text-xs font-medium border transition-colors ${
                  active
                    ? "bg-gray-800 border-gray-600 text-white"
                    : "bg-gray-800 border-gray-700 text-gray-400 hover:text-gray-200 hover:border-gray-600"
                }`}
              >
                {o.label}
              </Link>
            );
          })}
        </div>
      </div>

      <p className="text-xs text-gray-400">
        <span className="text-white font-semibold">{cohortCount}</span> of{" "}
        <span className="text-white font-semibold">{monitoredCount}</span> monitored dealers
        <span className="text-gray-600"> · </span>
        {SCOPE_DESCRIPTION[scope]}
        <span className="text-gray-600"> · </span>
        all figures below cover exactly these {cohortCount} dealers
      </p>

      {excluded.length > 0 && (
        <details className="w-full">
          <summary className="text-xs text-gray-500 hover:text-gray-300 cursor-pointer">
            {excluded.length} dealer{excluded.length === 1 ? "" : "s"} outside this scope — excluded
            from all figures (history retained)
          </summary>
          <ul className="mt-2 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-x-6 gap-y-1">
            {excluded.map((d) => (
              <li key={d.id} className="flex items-center justify-between gap-3 text-xs">
                <span className="text-gray-400 truncate">{d.name}</span>
                <FreshnessBadge freshness={d.freshness} ageDays={d.ageDays} />
              </li>
            ))}
          </ul>
          <p className="mt-2 text-[11px] text-gray-600">
            A missed capture is not an empty lot. These dealers are still monitored on the normal
            schedule and return automatically once a validated capture lands in range.
          </p>
        </details>
      )}
    </div>
  );
}
