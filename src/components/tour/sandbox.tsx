/**
 * Sandbox primitives + fake data for the simulated walkthroughs.
 *
 * NOTHING in this file touches Supabase, the router, or real state. Every name
 * here is invented: the clubs are not real Cornell organizations, carry no
 * Cornell branding, and the brands are fictional so a tutorial screenshot can
 * never be mistaken for a real drop or imply a partnership that does not exist.
 *
 * The primitives deliberately mirror the real app's visual language (saffron
 * primary, rounded-2xl surfaces, Cabinet Grotesk display type) without importing
 * the real components, so a UI refactor can never break the tutorial and the
 * tutorial can never accidentally fire a real mutation.
 */

import { useState, type ReactNode } from "react";
import { Check, Minus, Plus, Star } from "lucide-react";
import { cn } from "@/lib/utils";

/* ------------------------------------------------------------------ */
/* Fake data                                                           */
/* ------------------------------------------------------------------ */

/** Invented clubs. Not real Cornell orgs, and no "Cornell" in any name. */
export const DEMO_CLUBS = {
  testing: "Testing Club",
  sample: "Sample Society",
  demo: "Demo Robotics",
  example: "Example Dance Crew",
  placeholder: "Placeholder Athletics",
} as const;

/** Invented brands, so the tutorial never implies a real vendor partnership. */
export const DEMO_BRANDS = [
  "Sunrise Donuts",
  "Midnight Cookie Co.",
  "Boba Lab",
  "Rolling Hills BBQ",
] as const;

/** Invented students. */
export const DEMO_PEOPLE = {
  you: { name: "Jordan Reyes", netid: "jr998", venmo: "jordan-reyes-demo" },
  friend1: { name: "Sam Patel", netid: "sp421", venmo: "sam-p-demo" },
  friend2: { name: "Alex Kim", netid: "ak305", venmo: "alex-kim-demo" },
  friend3: { name: "Riley Chen", netid: "rc117", venmo: "riley-c-demo" },
} as const;

/** Generic pickup spots, not real campus buildings. */
export const DEMO_SPOTS = [
  "North Quad Lawn",
  "Main Library Steps",
  "Union Courtyard",
] as const;

export const DEMO_DROPS = [
  {
    id: "d1",
    brand: "Sunrise Donuts",
    club: DEMO_CLUBS.testing,
    title: "Glazed dozen drop",
    price: "$14.99",
    rating: 4.8,
    reviews: 26,
    tags: ["Vegetarian"],
    ends: "4h 12m",
    spot: DEMO_SPOTS[0],
  },
  {
    id: "d2",
    brand: "Midnight Cookie Co.",
    club: DEMO_CLUBS.sample,
    title: "Late-night 12-box",
    price: "$18.00",
    rating: 4.6,
    reviews: 41,
    tags: ["Vegetarian", "Nut-free"],
    ends: "1h 05m",
    spot: DEMO_SPOTS[1],
  },
  {
    id: "d3",
    brand: "Boba Lab",
    club: DEMO_CLUBS.demo,
    title: "Milk tea run",
    price: "$6.50",
    rating: 4.9,
    reviews: 12,
    tags: ["Vegan option"],
    ends: "22h 40m",
    spot: DEMO_SPOTS[2],
  },
] as const;

/* ------------------------------------------------------------------ */
/* Layout primitives                                                   */
/* ------------------------------------------------------------------ */

/**
 * The framed "app screen" every demo renders inside. The label across the top
 * is a constant reminder that none of this is live.
 */
export function Screen({
  label,
  children,
  className,
}: {
  label: string;
  children: ReactNode;
  className?: string;
}) {
  return (
    <div className="overflow-hidden rounded-2xl border border-border bg-surface">
      <div className="flex items-center justify-between gap-2 border-b border-border bg-surface-raised px-3 py-2">
        <span className="truncate text-xs font-bold uppercase tracking-wide text-ink-muted">
          {label}
        </span>
        <span className="shrink-0 rounded-full bg-primary/20 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-ink">
          Sample data
        </span>
      </div>
      <div className={cn("p-3", className)}>{children}</div>
    </div>
  );
}

/** A callout under a demo: why this matters, or a rule worth remembering. */
export function Note({ children, tone = "info" }: { children: ReactNode; tone?: "info" | "warn" }) {
  return (
    <p
      className={cn(
        "mt-3 rounded-xl border px-3 py-2 text-xs leading-relaxed",
        tone === "warn"
          ? "border-accent/40 bg-accent/10 text-ink"
          : "border-border bg-surface-raised text-ink-muted",
      )}
    >
      {children}
    </p>
  );
}

/** "Try it" nudge. Flips to a confirmation once the learner does the thing. */
export function TryIt({ done, children }: { done: boolean; children: ReactNode }) {
  return (
    <p
      className={cn(
        "mt-3 flex items-start gap-1.5 text-xs font-semibold",
        done ? "text-primary-dark" : "text-ink-muted",
      )}
      aria-live="polite"
    >
      {done ? (
        <Check className="mt-0.5 size-3.5 shrink-0" aria-hidden="true" />
      ) : (
        <span aria-hidden="true" className="mt-0.5 shrink-0">
          &rarr;
        </span>
      )}
      <span>{children}</span>
    </p>
  );
}

/* ------------------------------------------------------------------ */
/* Interactive primitives                                              */
/* ------------------------------------------------------------------ */

export function Chip({
  active,
  onClick,
  children,
  className,
}: {
  active?: boolean;
  onClick?: () => void;
  children: ReactNode;
  className?: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={cn(
        "rounded-full border px-3 py-1 text-xs font-bold transition-colors duration-150 [transition-timing-function:var(--ease-out)] active:scale-[0.97]",
        active
          ? "border-transparent bg-ink text-surface-raised"
          : "border-border bg-surface-raised text-ink-muted hover-fine:border-primary hover-fine:text-ink",
        className,
      )}
    >
      {children}
    </button>
  );
}

/** Small pill button used for in-demo actions ("Verify", "Approve", ...). */
export function MiniButton({
  onClick,
  children,
  tone = "primary",
  disabled,
  className,
}: {
  onClick?: () => void;
  children: ReactNode;
  tone?: "primary" | "quiet" | "danger";
  disabled?: boolean;
  className?: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className={cn(
        "inline-flex items-center gap-1.5 rounded-xl px-3 py-1.5 text-xs font-bold transition-colors duration-150 [transition-timing-function:var(--ease-out)] active:scale-[0.97] disabled:pointer-events-none disabled:opacity-45",
        tone === "primary" && "bg-primary text-on-primary hover-fine:bg-primary-dark",
        tone === "quiet" &&
          "border border-border bg-surface-raised text-ink hover-fine:border-primary",
        tone === "danger" && "border border-accent/40 bg-accent/10 text-accent",
        className,
      )}
    >
      {children}
    </button>
  );
}

export function Stepper({
  value,
  onChange,
  max = 9,
  label,
}: {
  value: number;
  onChange: (next: number) => void;
  max?: number;
  label: string;
}) {
  return (
    <div className="flex items-center gap-1.5">
      <button
        type="button"
        aria-label={`Remove one ${label}`}
        onClick={() => onChange(Math.max(0, value - 1))}
        className="flex size-7 items-center justify-center rounded-lg border border-border bg-surface-raised text-ink active:scale-[0.95] disabled:opacity-40"
        disabled={value === 0}
      >
        <Minus className="size-3.5" aria-hidden="true" />
      </button>
      <span className="w-5 text-center text-sm font-bold tabular-nums">{value}</span>
      <button
        type="button"
        aria-label={`Add one ${label}`}
        onClick={() => onChange(Math.min(max, value + 1))}
        className="flex size-7 items-center justify-center rounded-lg border border-border bg-surface-raised text-ink active:scale-[0.95] disabled:opacity-40"
        disabled={value >= max}
      >
        <Plus className="size-3.5" aria-hidden="true" />
      </button>
    </div>
  );
}

export function Toggle({
  checked,
  onChange,
  label,
  hint,
}: {
  checked: boolean;
  onChange: (next: boolean) => void;
  label: string;
  hint?: string;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      onClick={() => onChange(!checked)}
      className="flex w-full items-center justify-between gap-3 rounded-xl border border-border bg-surface-raised px-3 py-2.5 text-left active:scale-[0.99]"
    >
      <span className="min-w-0">
        <span className="block text-sm font-bold text-ink">{label}</span>
        {hint && <span className="mt-0.5 block text-xs text-ink-muted">{hint}</span>}
      </span>
      <span
        className={cn(
          "relative h-6 w-11 shrink-0 rounded-full transition-colors duration-200 [transition-timing-function:var(--ease-out)]",
          checked ? "bg-primary" : "bg-border",
        )}
      >
        <span
          className={cn(
            "absolute top-0.5 size-5 rounded-full bg-surface-raised shadow-sm transition-[left] duration-200 [transition-timing-function:var(--ease-out)]",
            checked ? "left-[1.375rem]" : "left-0.5",
          )}
        />
      </span>
    </button>
  );
}

/** Interactive star rating used in the reviews step. */
export function StarPicker({
  value,
  onChange,
}: {
  value: number;
  onChange: (next: number) => void;
}) {
  return (
    <div className="flex items-center gap-1" role="radiogroup" aria-label="Sample star rating">
      {[1, 2, 3, 4, 5].map((star) => (
        <button
          key={star}
          type="button"
          role="radio"
          aria-checked={value === star}
          aria-label={`${star} star${star === 1 ? "" : "s"}`}
          onClick={() => onChange(star)}
          className="rounded-md p-0.5 active:scale-[0.95]"
        >
          <Star
            className={cn("size-6", star <= value ? "text-primary" : "text-border")}
            fill={star <= value ? "currentColor" : "none"}
            aria-hidden="true"
          />
        </button>
      ))}
    </div>
  );
}

/** Read-only star row for fake reviews and ratings. */
export function StarRow({ value, className }: { value: number; className?: string }) {
  return (
    <span className={cn("inline-flex items-center gap-0.5", className)} aria-hidden="true">
      {[1, 2, 3, 4, 5].map((star) => (
        <Star
          key={star}
          className={cn("size-3", star <= Math.round(value) ? "text-primary" : "text-border")}
          fill={star <= Math.round(value) ? "currentColor" : "none"}
        />
      ))}
    </span>
  );
}

/** Simple tab strip used by several demos. */
export function Tabs<T extends string>({
  tabs,
  value,
  onChange,
}: {
  tabs: readonly T[];
  value: T;
  onChange: (next: T) => void;
}) {
  return (
    <div className="flex gap-1.5 overflow-x-auto pb-1" role="tablist">
      {tabs.map((tab) => (
        <button
          key={tab}
          type="button"
          role="tab"
          aria-selected={value === tab}
          onClick={() => onChange(tab)}
          className={cn(
            "shrink-0 rounded-full px-3 py-1 text-xs font-bold transition-colors duration-150",
            value === tab
              ? "bg-primary/25 text-ink"
              : "text-ink-muted hover-fine:bg-primary/10 hover-fine:text-ink",
          )}
        >
          {tab}
        </button>
      ))}
    </div>
  );
}

/** A fake listing card, matching the shape of the real feed card. */
export function DropCard({
  drop,
  onClick,
  compact,
}: {
  drop: (typeof DEMO_DROPS)[number];
  onClick?: () => void;
  compact?: boolean;
}) {
  const Wrapper = onClick ? "button" : "div";
  return (
    <Wrapper
      {...(onClick ? { type: "button" as const, onClick } : {})}
      className={cn(
        "w-full rounded-xl border border-border bg-surface-raised p-3 text-left",
        onClick && "hover-fine:border-primary active:scale-[0.99]",
      )}
    >
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="truncate text-xs font-bold uppercase tracking-wide text-ink-muted">
            {drop.brand}
          </p>
          <p className="truncate font-display text-sm font-extrabold text-ink">{drop.title}</p>
          <p className="truncate text-xs text-ink-muted">by {drop.club}</p>
        </div>
        <span className="shrink-0 rounded-full bg-accent/15 px-2 py-0.5 text-[10px] font-bold text-accent">
          {drop.ends}
        </span>
      </div>
      {!compact && (
        <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-ink-muted">
          <span className="font-bold text-ink">{drop.price}</span>
          <span className="inline-flex items-center gap-1">
            <StarRow value={drop.rating} />
            {drop.rating} ({drop.reviews})
          </span>
          {drop.tags.map((tag) => (
            <span key={tag} className="rounded-full bg-tag-green/60 px-2 py-0.5 text-[10px] font-semibold text-ink">
              {tag}
            </span>
          ))}
        </div>
      )}
    </Wrapper>
  );
}

/** Key/value row used across the club and admin demos. */
export function Row({
  left,
  right,
  sub,
}: {
  left: ReactNode;
  right?: ReactNode;
  sub?: ReactNode;
}) {
  return (
    <div className="flex items-center justify-between gap-3 border-b border-border py-2 last:border-b-0">
      <div className="min-w-0">
        <div className="truncate text-sm font-semibold text-ink">{left}</div>
        {sub && <div className="truncate text-xs text-ink-muted">{sub}</div>}
      </div>
      {right && <div className="shrink-0">{right}</div>}
    </div>
  );
}

/** Fake stat tile for the analytics and admin overview demos. */
export function Stat({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div className="rounded-xl border border-border bg-surface-raised p-2.5">
      <p className="text-[10px] font-bold uppercase tracking-wide text-ink-muted">{label}</p>
      <p className="mt-0.5 font-display text-base font-extrabold text-ink">{value}</p>
      {sub && <p className="text-[10px] text-ink-muted">{sub}</p>}
    </div>
  );
}

/**
 * A decorative stand-in for a QR pass. Not a scannable code - drawing a real one
 * would imply the tutorial pass works at a pickup, and it does not.
 */
export function FakeQR({ seed = 7 }: { seed?: number }) {
  // Deterministic pseudo-random blocks so the "code" looks plausible and stable.
  const cells = Array.from({ length: 64 }, (_, index) => ((index * seed) % 5) < 2);
  return (
    <div
      className="grid size-28 grid-cols-8 gap-0.5 rounded-lg bg-surface-raised p-1.5 ring-1 ring-border"
      aria-label="Illustration of a QR pickup pass"
      role="img"
    >
      {cells.map((filled, index) => (
        <span
          key={index}
          className={cn("rounded-[1px]", filled ? "bg-ink" : "bg-transparent")}
        />
      ))}
    </div>
  );
}

/** Bar chart stand-in for the analytics demo. */
export function MiniBars({ data }: { data: { label: string; value: number }[] }) {
  const max = Math.max(...data.map((d) => d.value), 1);
  return (
    <div className="flex h-24 items-end gap-1.5">
      {data.map((d) => (
        <div key={d.label} className="flex flex-1 flex-col items-center gap-1">
          <div
            className="w-full rounded-t-md bg-primary"
            style={{ height: `${Math.max(8, (d.value / max) * 78)}px` }}
          />
          <span className="truncate text-[9px] font-semibold text-ink-muted">{d.label}</span>
        </div>
      ))}
    </div>
  );
}

/**
 * Tiny local-state helper so a step can record "the learner actually did the
 * thing" once, without every demo re-implementing the same latch.
 */
export function useLatch(onFirst?: () => void): [boolean, () => void] {
  const [hit, setHit] = useState(false);
  return [
    hit,
    () => {
      if (!hit) {
        setHit(true);
        onFirst?.();
      }
    },
  ];
}
