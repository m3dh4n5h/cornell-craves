import { useRef, useState } from "react";
import { CalendarPlus, ChevronDown, Download } from "lucide-react";
import { AnchoredPanel } from "@/components/ui/anchored-menu";
import { Button } from "@/components/ui/button";
import { downloadIcs, googleCalendarUrl, type CalendarOption } from "@/lib/calendar";
import { cn } from "@/lib/utils";

interface AddToCalendarButtonProps {
  /** Stable per pickup pass; used for the .ics filename and UID. */
  id: string;
  /** One option per pickup a buyer could be using. Exactly one renders as two
   * plain buttons; more than one opens a picker so they choose which date. */
  options: CalendarOption[];
}

/** Meant to sit inside a `flex flex-wrap gap-2` action row. */
export function AddToCalendarButton({ id, options }: AddToCalendarButtonProps) {
  const [open, setOpen] = useState(false);
  const anchorRef = useRef<HTMLDivElement>(null);

  if (options.length === 0) return null;

  if (options.length === 1) {
    return <CalendarActions id={id} option={options[0]} />;
  }

  return (
    <div ref={anchorRef} className="relative">
      <Button
        type="button"
        variant="secondary"
        size="sm"
        onClick={() => setOpen((value) => !value)}
        aria-haspopup="menu"
        aria-expanded={open}
      >
        <CalendarPlus className="size-4" aria-hidden="true" />
        Add to calendar
        <ChevronDown className={cn("size-3.5 transition-transform duration-150", open && "rotate-180")} aria-hidden="true" />
      </Button>
      <AnchoredPanel
        anchorRef={anchorRef}
        open={open}
        onDismiss={() => setOpen(false)}
        role="menu"
        aria-label="Choose which pickup to save"
        width={300}
      >
        <p className="shrink-0 px-3.5 pb-1 pt-2.5 text-[11px] font-semibold uppercase tracking-wide text-ink-muted">
          Which pickup are you using?
        </p>
        <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain pb-1.5">
          {options.map((option) => (
            <div key={option.key} className="flex items-center gap-1 px-2 py-1">
              <span className="min-w-0 flex-1 px-1.5 text-sm leading-snug">{option.label}</span>
              <button
                type="button"
                role="menuitem"
                aria-label={`Add ${option.label} to Google Calendar`}
                onClick={() => {
                  window.open(googleCalendarUrl(option.event), "_blank", "noopener,noreferrer");
                  setOpen(false);
                }}
                className="flex size-8 shrink-0 items-center justify-center rounded-lg text-ink-muted hover-fine:bg-ink/[0.06] hover-fine:text-ink"
              >
                <CalendarPlus className="size-4" aria-hidden="true" />
              </button>
              <button
                type="button"
                role="menuitem"
                aria-label={`Download .ics for ${option.label}`}
                onClick={() => {
                  downloadIcs(option.event, `${id}-${option.key}`);
                  setOpen(false);
                }}
                className="flex size-8 shrink-0 items-center justify-center rounded-lg text-ink-muted hover-fine:bg-ink/[0.06] hover-fine:text-ink"
              >
                <Download className="size-4" aria-hidden="true" />
              </button>
            </div>
          ))}
        </div>
      </AnchoredPanel>
    </div>
  );
}

function CalendarActions({ id, option }: { id: string; option: CalendarOption }) {
  return (
    <>
      <Button
        type="button"
        variant="secondary"
        size="sm"
        onClick={() => window.open(googleCalendarUrl(option.event), "_blank", "noopener,noreferrer")}
      >
        <CalendarPlus className="size-4" aria-hidden="true" />
        Add to Google Calendar
      </Button>
      <Button type="button" variant="ghost" size="sm" onClick={() => downloadIcs(option.event, `${id}-${option.key}`)}>
        <Download className="size-4" aria-hidden="true" />
        Download .ics
      </Button>
    </>
  );
}
