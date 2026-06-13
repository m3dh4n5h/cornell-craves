/** Skeleton mirroring the exact shape of ListingCard so loading does not shift layout. */
export function SkeletonCard() {
  return (
    <div
      className="animate-pulse rounded-2xl border border-border bg-surface-raised p-4"
      aria-hidden="true"
    >
      <div className="flex items-start gap-3">
        <div className="size-12 shrink-0 rounded-xl bg-border/60" />
        <div className="min-w-0 flex-1 space-y-2 pt-0.5">
          <div className="h-4 w-3/4 rounded-md bg-border/60" />
          <div className="h-3 w-1/2 rounded-md bg-border/50" />
        </div>
      </div>
      <div className="mt-4 space-y-2">
        <div className="h-3 w-full rounded-md bg-border/50" />
        <div className="h-3 w-2/3 rounded-md bg-border/50" />
      </div>
      <div className="mt-4 flex items-center justify-between">
        <div className="h-5 w-20 rounded-full bg-border/60" />
        <div className="h-5 w-16 rounded-full bg-border/50" />
      </div>
    </div>
  );
}
