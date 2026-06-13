import { formatPrice } from "@/lib/format";
import { cn } from "@/lib/utils";

interface SplitTypeSelectorProps {
  itemPrice: number;
  value: number;
  onChange: (value: number) => void;
}

const SPLIT_OPTIONS = [2, 3, 4];

export function SplitTypeSelector({ itemPrice, value, onChange }: SplitTypeSelectorProps) {
  return (
    <div className="flex flex-wrap gap-2" role="radiogroup" aria-label="Split between how many people">
      {SPLIT_OPTIONS.map((people) => {
        const selected = value === people;
        return (
          <button
            key={people}
            type="button"
            role="radio"
            aria-checked={selected}
            onClick={() => onChange(people)}
            className={cn(
              "flex min-h-11 flex-col items-center rounded-2xl border px-4 py-2 transition-colors duration-150 [transition-timing-function:var(--ease-out)] active:scale-[0.97]",
              selected
                ? "border-ink bg-ink text-surface-raised"
                : "border-border bg-surface-raised text-ink hover-fine:border-primary",
            )}
          >
            <span className="text-sm font-bold">{people} people</span>
            <span className={cn("font-mono text-xs", selected ? "opacity-80" : "text-ink-muted")}>
              {formatPrice(itemPrice / people)} each
            </span>
          </button>
        );
      })}
    </div>
  );
}
