import { forwardRef, type ButtonHTMLAttributes } from "react";
import { cva, type VariantProps } from "class-variance-authority";
import { Loader2 } from "lucide-react";
import { cn } from "@/lib/utils";

/*
 * Radius system: controls are rounded-xl, surfaces rounded-2xl, chips rounded-full.
 * All 8 interaction states: default, hover (gated to fine pointers), focus-visible,
 * active (scale 0.97), disabled (opacity 0.45), loading, plus error/success styling
 * handled by the destructive variant and toasts at the call site.
 */
const buttonVariants = cva(
  "inline-flex select-none items-center justify-center gap-2 whitespace-nowrap rounded-xl font-display font-bold transition-[background-color,border-color,color,transform,box-shadow] duration-150 [transition-timing-function:var(--ease-out)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary-dark active:scale-[0.97] disabled:pointer-events-none disabled:opacity-45",
  {
    variants: {
      variant: {
        primary:
          "bg-primary text-on-primary shadow-[0_1px_3px_oklch(60%_0.17_72/0.3)] hover-fine:bg-primary-dark",
        secondary:
          "border border-border bg-surface-raised text-ink hover-fine:border-primary hover-fine:bg-primary/10",
        ghost: "text-ink hover-fine:bg-primary/15",
        destructive: "bg-accent text-on-accent hover-fine:bg-accent/85",
      },
      size: {
        sm: "h-9 px-3.5 text-sm",
        md: "h-11 px-5 text-sm",
        lg: "h-12 px-6 text-base",
      },
    },
    defaultVariants: {
      variant: "primary",
      size: "md",
    },
  },
);

export interface ButtonProps
  extends ButtonHTMLAttributes<HTMLButtonElement>,
    VariantProps<typeof buttonVariants> {
  loading?: boolean;
}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant, size, loading = false, disabled, children, ...props }, ref) => (
    <button
      ref={ref}
      className={cn(buttonVariants({ variant, size }), className)}
      disabled={disabled || loading}
      aria-busy={loading || undefined}
      {...props}
    >
      {loading && <Loader2 className="size-4 animate-spin" aria-hidden="true" />}
      {children}
    </button>
  ),
);
Button.displayName = "Button";
