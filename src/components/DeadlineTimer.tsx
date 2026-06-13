import { useEffect, useState } from "react";
import { Clock } from "lucide-react";
import { deadlineInfo } from "@/lib/groups";
import { cn } from "@/lib/utils";

const TONE_CLASSES = {
  normal: "text-ink-muted",
  soon: "text-primary-dark",
  urgent: "text-accent",
} as const;

interface DeadlineTimerProps {
  deadline: string;
  prefix?: string;
  className?: string;
}

/**
 * Payment deadline countdown. Color shifts saffron under 6h and chili under
 * 2h; deliberately no animation, just a 30s re-render.
 */
export function DeadlineTimer({ deadline, prefix = "Pay within", className }: DeadlineTimerProps) {
  const [info, setInfo] = useState(() => deadlineInfo(deadline));

  useEffect(() => {
    setInfo(deadlineInfo(deadline));
    const id = window.setInterval(() => setInfo(deadlineInfo(deadline)), 30_000);
    return () => window.clearInterval(id);
  }, [deadline]);

  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 text-xs font-semibold",
        TONE_CLASSES[info.tone],
        className,
      )}
    >
      <Clock className="size-3.5" aria-hidden="true" />
      {info.expired ? info.label : `${prefix} ${info.label.replace(" left", "")}`}
    </span>
  );
}
