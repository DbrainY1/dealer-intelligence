import { Skeleton, SkeletonPage, SkeletonPanel, SkeletonTable } from "@/components/Skeleton";

// Suspense fallback for /dashboard/competitors (Market Pulse).
// Mirrors the title, dealer scorecards, 90-day trend chart, and tables.
export default function CompetitorsLoading() {
  return (
    <SkeletonPage className="p-6 space-y-6" label="Loading market pulse">
      <Skeleton className="h-6 w-40" />

      {/* Dealer scorecards — wraps on narrow screens */}
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3">
        {Array.from({ length: 10 }).map((_, i) => (
          <div
            key={i}
            className="bg-gray-900 border border-gray-800 rounded-lg p-3 space-y-2"
          >
            <Skeleton className="h-3.5 w-full" />
            <Skeleton className="h-7 w-16" />
            <Skeleton className="h-3 w-20" />
          </div>
        ))}
      </div>

      {/* 90-day inventory trend chart */}
      <SkeletonPanel titleWidth="w-60" bodyHeight="h-[250px]" />

      {/* New listings + estimated sales tables */}
      <div className="bg-gray-900 border border-gray-800 rounded-lg p-4 space-y-4">
        <Skeleton className="h-4 w-72" />
        <SkeletonTable columns={4} rows={5} />
      </div>
      <div className="bg-gray-900 border border-gray-800 rounded-lg p-4 space-y-4">
        <Skeleton className="h-4 w-64" />
        <SkeletonTable columns={4} rows={5} />
      </div>
    </SkeletonPage>
  );
}
