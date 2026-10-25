import { Skeleton, SkeletonPage } from "@/components/Skeleton";

// Suspense fallback for /dashboard/market (and /dashboard/market/archive).
// Mirrors the eyebrow + title + intelligence brief panel + signal grid.
export default function MarketLoading() {
  return (
    <SkeletonPage
      className="min-h-screen bg-gray-950 px-6 py-6"
      label="Loading the market"
    >
      <div className="mb-6 space-y-2">
        <Skeleton className="h-3 w-48" />
        <Skeleton className="h-8 w-60" />
        <Skeleton className="h-4 w-full max-w-xl" />
      </div>

      {/* Market Intelligence Brief */}
      <section className="rounded-2xl border border-gray-800 bg-gray-900/90 p-6 mb-6">
        <div className="flex items-start justify-between gap-4 mb-4">
          <div className="space-y-2">
            <Skeleton className="h-3 w-52" />
            <Skeleton className="h-7 w-48" />
            <Skeleton className="h-3.5 w-64" />
          </div>
          <Skeleton className="h-9 w-28 shrink-0 rounded-lg" />
        </div>
        <div className="max-w-5xl space-y-4">
          {Array.from({ length: 3 }).map((_, i) => (
            <div key={i} className="space-y-2">
              <Skeleton className="h-4 w-full" />
              <Skeleton className="h-4 w-full" />
              <Skeleton className="h-4 w-4/5" />
            </div>
          ))}
        </div>
      </section>

      {/* Signal pills */}
      <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
        {Array.from({ length: 6 }).map((_, i) => (
          <Skeleton key={i} className="h-16 w-full rounded-xl" />
        ))}
      </div>
    </SkeletonPage>
  );
}
