import { SkeletonCard } from "cornell-craves";

/** The loading placeholder for one feed card. */
export function Single() {
  return (
    <div style={{ maxWidth: 380 }}>
      <SkeletonCard />
    </div>
  );
}

/** How the feed uses it: a short stack while listings load. */
export function FeedLoading() {
  return (
    <div style={{ display: "grid", gap: 12, maxWidth: 380 }}>
      <SkeletonCard />
      <SkeletonCard />
      <SkeletonCard />
    </div>
  );
}
