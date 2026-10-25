import { Skeleton, SkeletonPage, SkeletonPanel, SkeletonTable } from "@/components/Skeleton";

// Suspense fallback for /dashboard (Market Overview) and for any nested
// dashboard route that does not define its own loading.tsx. Mirrors the
// Market Overview layout: title, 2x2 intel cards, two charts, dealer table.
export default function DashboardLoading() {
  return (
    <SkeletonPage className="p-6 space-y-6" label="Loading market overview">
      <Skeleton className="h-6 w-72" />

      {/* 2x2 intel cards — same grid as the live page on every breakpoint */}
      <div className="grid grid-cols-2 gap-3 max-w-[900px]">
        {Array.from({ length: 4 }).map((_, i) => (
          <div
            key={i}
            className="bg-gray-900 rounded-lg overflow-hidden border border-gray-800"
          >
            <Skeleton className="h-[3px] w-full rounded-none" />
            <div className="p-3 space-y-1.5">
              <Skeleton className="h-6 w-32" />
              <Skeleton className="h-9 w-24" />
              <div className="space-y-1 pt-0.5">
                <Skeleton className="h-3.5 w-40" />
                <Skeleton className="h-3.5 w-36" />
              </div>
            </div>
          </div>
        ))}
      </div>

      <div className="space-y-6">
        <SkeletonPanel titleWidth="w-44" />
        <SkeletonPanel titleWidth="w-40" />
        <SkeletonTable columns={6} rows={6} />
      </div>
    </SkeletonPage>
  );
}
