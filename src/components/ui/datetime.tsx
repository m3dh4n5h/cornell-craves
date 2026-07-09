import { forwardRef, type InputHTMLAttributes } from "react";
import { Calendar, CalendarClock } from "lucide-react";
import { cn } from "@/lib/utils";

export interface DateTimeFieldProps extends InputHTMLAttributes<HTMLInputElement> {
  invalid?: boolean;
  type?: "datetime-local" | "date";
}

/**
 * Native date/datetime input dressed to match Input. Two upgrades over the raw
 * control: the invisible native picker button is stretched across the whole
 * field (any tap opens the calendar, not just a tiny icon), and a Lucide icon
 * on the right signals "this opens a picker" consistently across browsers.
 * The picker itself stays native: on phones that is the platform wheel/calendar,
 * which is the easiest input method. [color-scheme:light] keeps the popup
 * matching the app's light surfaces.
 */
export const DateTimeField = forwardRef<HTMLInputElement, DateTimeFieldProps>(
  ({ className, invalid = false, type = "datetime-local", ...props }, ref) => {
    const Icon = type === "date" ? Calendar : CalendarClock;
    return (
      <div className="relative w-full">
        <input
          ref={ref}
          type={type}
          aria-invalid={invalid || undefined}
          className={cn(
            "h-11 w-full min-w-0 appearance-none rounded-xl border border-border bg-surface-raised pl-3.5 pr-11 text-left text-base text-ink transition-[border-color,box-shadow] duration-150 [transition-timing-function:var(--ease-out)] [color-scheme:light] focus-visible:border-primary-dark focus-visible:outline-2 focus-visible:outline-offset-0 focus-visible:outline-primary/40 disabled:pointer-events-none disabled:opacity-45",
            // Stretch the (invisible) native picker button over the whole field;
            // positioned against the relative wrapper, so inset-0 covers it all.
            "[&::-webkit-calendar-picker-indicator]:absolute [&::-webkit-calendar-picker-indicator]:inset-0 [&::-webkit-calendar-picker-indicator]:h-full [&::-webkit-calendar-picker-indicator]:w-full [&::-webkit-calendar-picker-indicator]:cursor-pointer [&::-webkit-calendar-picker-indicator]:opacity-0",
            // iOS renders date inputs as centered buttons; left-align to match Input.
            "[&::-webkit-date-and-time-value]:text-left",
            invalid && "border-accent focus-visible:border-accent focus-visible:outline-accent/30",
            className,
          )}
          {...props}
        />
        <Icon
          className="pointer-events-none absolute right-3.5 top-1/2 size-4 -translate-y-1/2 text-ink-muted"
          aria-hidden="true"
        />
      </div>
    );
  },
);
DateTimeField.displayName = "DateTimeField";
