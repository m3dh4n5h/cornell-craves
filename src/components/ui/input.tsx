import { forwardRef, type InputHTMLAttributes } from "react";
import { cn } from "@/lib/utils";

export interface InputProps extends InputHTMLAttributes<HTMLInputElement> {
  invalid?: boolean;
}

export const Input = forwardRef<HTMLInputElement, InputProps>(
  ({ className, invalid = false, type = "text", ...props }, ref) => (
    <input
      ref={ref}
      type={type}
      aria-invalid={invalid || undefined}
      className={cn(
        "h-11 w-full rounded-xl border border-border bg-surface-raised px-3.5 text-base text-ink transition-[border-color,box-shadow] duration-150 [transition-timing-function:var(--ease-out)] placeholder:text-ink-muted/70 focus-visible:border-primary-dark focus-visible:outline-2 focus-visible:outline-offset-0 focus-visible:outline-primary/40 disabled:pointer-events-none disabled:opacity-45",
        invalid && "border-accent focus-visible:border-accent focus-visible:outline-accent/30",
        className,
      )}
      {...props}
    />
  ),
);
Input.displayName = "Input";
