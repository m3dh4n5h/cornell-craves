import { formatPrice } from "@/lib/format";
import { cn } from "@/lib/utils";

interface GoalProgressProps {
  goal: number;
  raised: number;
  /** Optional heading; defaults to "Club goal". Not the drop's cause (058). */
  label?: string | null;
  /** Thin bar and one line of text, for feed cards and dashboard rows. */
  compact?: boolean;
  className?: string;
}

/**
 * Fundraiser progress. The bar stops at 100%, but the text always shows the
 * real amount, so "$950 of $800" is possible once a goal is beaten.
 */
export function GoalProgress({ goal, raised, label, compact = false, className }: GoalProgressProps) {
  if (!(goal > 0)) return null;
  const shown = Math.max(0, Math.round(raised));
  const fraction = Math.min(1, shown / goal);
  const met = shown >= goal;
  const amounts = `${formatPrice(shown)} of ${formatPrice(goal)}`;

  return (
    <div className={className}>
      {!compact && (
        <p className="mb-1.5 text-sm font-semibold text-ink">
          <span className="break-words">{label || "Club goal"}</span>
        </p>
      )}
      <div
        role="progressbar"
        aria-label={label ? `Raised toward ${label}` : "Raised toward club goal"}
        aria-valuemin={0}
        aria-valuemax={goal}
        aria-valuenow={Math.min(shown, goal)}
        aria-valuetext={`${amounts} raised`}
        className={cn("overflow-hidden rounded-full bg-border/70", compact ? "h-1.5" : "h-2.5")}
      >
        <div
          className="h-full origin-left rounded-full bg-primary transition-transform duration-500 [transition-timing-function:var(--ease-out)] motion-reduce:transition-none"
          style={{ transform: `scaleX(${fraction})` }}
        />
      </div>
      <p
        className={cn(
          "mt-1 flex items-center justify-between gap-2",
          compact ? "text-xs text-ink-muted" : "text-sm text-ink-muted",
        )}
      >
        <span>
          <span className="font-mono font-semibold text-ink">{formatPrice(shown)}</span> of{" "}
          <span className="font-mono">{formatPrice(goal)}</span>
          {compact ? " raised" : " raised so far"}
        </span>
        {met && <span className="font-semibold text-primary-dark">Goal met</span>}
      </p>
    </div>
  );
}
