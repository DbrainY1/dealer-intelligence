import { Skeleton, SkeletonPage } from "@/components/Skeleton";

// Suspense fallback for /dashboard/locations.
// Mirrors the heading, Map Intelligence panel, group legend, and map canvas.
// The map block reuses the live container's height so the swap does not shift
// the page.
export default function LocationsLoading() {
  return (
    <SkeletonPage className="p-6 space-y-4" label="Loading locations map">
      <div className="space-y-2">
        <Skeleton className="h-6 w-36" />
        <Skeleton className="h-4 w-80 max-w-full" />
      </div>

      <div className="space-y-3">
        {/* Map Intelligence toggles */}
        <div className="bg-gray-900 border border-gray-800 rounded-xl p-4 flex items-center gap-6">
          <Skeleton className="h-3 w-32 shrink-0" />
          <div className="flex flex-wrap gap-2 flex-1">
            {Array.from({ length: 6 }).map((_, i) => (
              <Skeleton key={i} className="h-8 w-36 rounded-lg" />
            ))}
          </div>
        </div>

        {/* Dealer group legend */}
        <div className="flex flex-wrap gap-4">
          {Array.from({ length: 3 }).map((_, i) => (
            <div key={i} className="flex items-center gap-2">
              <Skeleton className="w-3 h-3 rounded-full" />
              <Skeleton className="h-3 w-28" />
            </div>
          ))}
        </div>

        {/* Map canvas — same height rule as the live LocationsMap container,
            so revealing the real map does not shift the page. */}
        <div
          className="w-full rounded-lg border border-gray-800 animate-pulse motion-reduce:animate-none bg-gray-800"
          style={{ height: "calc(100vh - 300px)", minHeight: "500px" }}
          aria-hidden="true"
        />
      </div>
    </SkeletonPage>
  );
}
