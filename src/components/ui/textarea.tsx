import { forwardRef, type TextareaHTMLAttributes } from "react";
import { cn } from "@/lib/utils";

export interface TextareaProps extends TextareaHTMLAttributes<HTMLTextAreaElement> {
  invalid?: boolean;
}

export const Textarea = forwardRef<HTMLTextAreaElement, TextareaProps>(
  ({ className, invalid = false, ...props }, ref) => (
    <textarea
      ref={ref}
      aria-invalid={invalid || undefined}
      className={cn(
        "min-h-24 w-full rounded-xl border border-border bg-surface-raised px-3.5 py-2.5 text-base text-ink transition-[border-color,box-shadow] duration-150 [transition-timing-function:var(--ease-out)] placeholder:text-ink-muted/70 focus-visible:border-primary-dark focus-visible:outline-2 focus-visible:outline-offset-0 focus-visible:outline-primary/40 disabled:pointer-events-none disabled:opacity-45",
        invalid && "border-accent focus-visible:border-accent focus-visible:outline-accent/30",
        className,
      )}
      {...props}
    />
  ),
);
Textarea.displayName = "Textarea";
