import { forwardRef, type SelectHTMLAttributes } from "react";
import { ChevronDown } from "lucide-react";
import { cn } from "@/lib/utils";

export interface SelectProps extends SelectHTMLAttributes<HTMLSelectElement> {
  invalid?: boolean;
}

/**
 * Styled native select. The closed control matches Input exactly (height,
 * radius, border, focus ring); the open picker stays native, which is the
 * easiest and most familiar experience on phones. `appearance-none` strips the
 * browser chrome so the Lucide chevron is the one affordance everywhere.
 */
export const Select = forwardRef<HTMLSelectElement, SelectProps>(
  ({ className, invalid = false, children, ...props }, ref) => (
    <div className="relative w-full">
      <select
        ref={ref}
        aria-invalid={invalid || undefined}
        className={cn(
          "h-11 w-full cursor-pointer appearance-none truncate rounded-xl border border-border bg-surface-raised pl-3.5 pr-10 text-base text-ink transition-[border-color,box-shadow] duration-150 [transition-timing-function:var(--ease-out)] focus-visible:border-primary-dark focus-visible:outline-2 focus-visible:outline-offset-0 focus-visible:outline-primary/40 disabled:pointer-events-none disabled:opacity-45",
          invalid && "border-accent focus-visible:border-accent focus-visible:outline-accent/30",
          className,
        )}
        {...props}
      >
        {children}
      </select>
      <ChevronDown
        className="pointer-events-none absolute right-3.5 top-1/2 size-4 -translate-y-1/2 text-ink-muted"
        aria-hidden="true"
      />
    </div>
  ),
);
Select.displayName = "Select";
