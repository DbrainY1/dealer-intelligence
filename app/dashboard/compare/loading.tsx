import { Skeleton, SkeletonPage, SkeletonPanel, SkeletonTable } from "@/components/Skeleton";

// Suspense fallback for /dashboard/compare (Comparison Tool).
// Mirrors the header actions, dealer selection chips, metrics table, and chart.
export default function CompareLoading() {
  return (
    <SkeletonPage className="p-6 space-y-6" label="Loading comparison tool">
      {/* Header + action buttons */}
      <div className="flex items-center justify-between gap-4">
        <Skeleton className="h-6 w-48" />
        <div className="flex gap-2 shrink-0">
          <Skeleton className="h-9 w-24 rounded" />
          <Skeleton className="h-9 w-24 rounded" />
          <Skeleton className="h-9 w-28 rounded" />
        </div>
      </div>

      {/* Dealer selection chips */}
      <div className="bg-gray-900 border border-gray-800 rounded-lg p-4">
        <Skeleton className="h-3.5 w-52 mb-3" />
        <div className="flex flex-wrap gap-2">
          {Array.from({ length: 12 }).map((_, i) => (
            <Skeleton key={i} className="h-8 w-32 rounded" />
          ))}
        </div>
      </div>

      <SkeletonTable columns={7} rows={8} />
      <SkeletonPanel titleWidth="w-56" />
    </SkeletonPage>
  );
}
