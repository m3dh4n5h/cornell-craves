import type { LucideIcon } from "lucide-react";

export type Feature = { Icon: LucideIcon; title: string; body: string };

/** Two-column feature grid used by every audience tab on the About page. */
export function FeatureList({ features }: { features: Feature[] }) {
  return (
    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
      {features.map(({ Icon, title, body }) => (
        <div key={title} className="rounded-2xl border border-border bg-surface-raised p-4">
          <div className="flex items-center gap-2.5">
            <span className="flex size-8 shrink-0 items-center justify-center rounded-xl bg-primary/20">
              <Icon className="size-4 text-primary-dark" aria-hidden="true" />
            </span>
            <h3 className="font-display text-sm font-extrabold text-ink">{title}</h3>
          </div>
          <p className="mt-2 text-sm leading-relaxed text-ink-muted">{body}</p>
        </div>
      ))}
    </div>
  );
}

/** Placeholder while a lazily-loaded audience tab is fetched. */
export function FeatureListSkeleton() {
  return (
    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2" aria-busy="true" aria-label="Loading">
      {Array.from({ length: 4 }, (_, index) => (
        <div key={index} className="h-32 animate-pulse rounded-2xl bg-border/40" />
      ))}
    </div>
  );
}
