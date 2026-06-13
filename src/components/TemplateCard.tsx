import { Pencil, Send } from "lucide-react";
import type { RecurringTemplate } from "@/types/database";
import { brandInitials, brandTint } from "@/lib/brands";
import { priceRange } from "@/lib/format";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

const FREQUENCY_LABELS: Record<RecurringTemplate["frequency"], string> = {
  weekly: "Weekly",
  biweekly: "Every 2 weeks",
  monthly: "Monthly",
};

function formatNextRun(date: string | null): string | null {
  if (!date) return null;
  return new Date(`${date}T00:00:00`).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
  });
}

interface TemplateCardProps {
  template: RecurringTemplate;
  busy: boolean;
  onPost: () => void;
  onEdit: () => void;
  onToggleActive: () => void;
}

export function TemplateCard({ template, busy, onPost, onEdit, onToggleActive }: TemplateCardProps) {
  const range = priceRange(template.items ?? []);
  const itemCount = template.items?.length ?? 0;
  const nextRun = formatNextRun(template.next_run_date);

  return (
    <article
      className={cn(
        "rounded-2xl border border-border bg-surface-raised p-4",
        !template.is_active && "opacity-60",
      )}
    >
      <div className="flex items-start gap-3">
        <span
          className={cn(
            "flex size-12 shrink-0 items-center justify-center rounded-xl font-display text-base font-extrabold text-ink/80",
            brandTint(template.brand),
          )}
          aria-hidden="true"
        >
          {brandInitials(template.brand)}
        </span>
        <div className="min-w-0 flex-1">
          <h3 className="truncate text-base font-bold">{template.name}</h3>
          <p className="truncate text-sm text-ink-muted">
            {template.brand}
            {range ? `, ${range}` : ""}
            {itemCount > 0 ? `, ${itemCount} ${itemCount === 1 ? "item" : "items"}` : ""}
          </p>
        </div>
      </div>

      <div className="mt-3 flex flex-wrap items-center gap-2">
        <Badge variant="default">{FREQUENCY_LABELS[template.frequency]}</Badge>
        {nextRun && <Badge variant="neutral">Next run {nextRun}</Badge>}
        {!template.is_active && <Badge variant="urgent">Paused</Badge>}
      </div>

      <div className="mt-4 flex flex-wrap items-center gap-2">
        <Button size="sm" loading={busy} disabled={!template.is_active} onClick={onPost}>
          <Send className="size-3.5" aria-hidden="true" />
          Post now
        </Button>
        <Button variant="secondary" size="sm" onClick={onEdit}>
          <Pencil className="size-3.5" aria-hidden="true" />
          Edit
        </Button>
        <Button variant="ghost" size="sm" onClick={onToggleActive}>
          {template.is_active ? "Pause" : "Resume"}
        </Button>
      </div>
    </article>
  );
}
