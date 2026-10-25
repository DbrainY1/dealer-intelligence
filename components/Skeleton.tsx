// Presentational loading placeholders used by the dashboard `loading.tsx`
// files. Server components by default — these ship no client JavaScript and
// hold no state, so they cannot affect data, auth, or calculations.
//
// `motion-reduce:animate-none` honors prefers-reduced-motion.

export function Skeleton({ className = "" }: { className?: string }) {
  return (
    <div
      aria-hidden="true"
      className={`animate-pulse motion-reduce:animate-none rounded bg-gray-800 ${className}`}
    />
  );
}

/** Wrapper that announces the loading state to assistive tech. */
export function SkeletonPage({
  children,
  className = "",
  label = "Loading",
}: {
  children: React.ReactNode;
  className?: string;
  label?: string;
}) {
  return (
    <div role="status" aria-busy="true" aria-live="polite" className={className}>
      <span className="sr-only">{label}</span>
      {children}
    </div>
  );
}

/** Panel matching the `bg-gray-900 border border-gray-800 rounded-lg p-4` cards. */
export function SkeletonPanel({
  titleWidth = "w-40",
  bodyHeight = "h-[220px]",
}: {
  titleWidth?: string;
  bodyHeight?: string;
}) {
  return (
    <div className="bg-gray-900 border border-gray-800 rounded-lg p-4">
      <Skeleton className={`h-3.5 ${titleWidth} mb-3`} />
      <Skeleton className={`w-full ${bodyHeight}`} />
    </div>
  );
}

/** Table placeholder matching the dashboard's header-row + body-rows tables. */
export function SkeletonTable({
  columns = 6,
  rows = 6,
}: {
  columns?: number;
  rows?: number;
}) {
  return (
    <div className="bg-gray-900 border border-gray-800 rounded-lg overflow-hidden">
      <div className="bg-gray-800 px-4 py-3 flex gap-4">
        {Array.from({ length: columns }).map((_, i) => (
          <Skeleton key={i} className="h-3 flex-1 bg-gray-700" />
        ))}
      </div>
      <div className="divide-y divide-gray-800">
        {Array.from({ length: rows }).map((_, i) => (
          <div key={i} className="px-4 py-3 flex gap-4">
            {Array.from({ length: columns }).map((_, j) => (
              <Skeleton key={j} className="h-3 flex-1" />
            ))}
          </div>
        ))}
      </div>
    </div>
  );
}
