import { formatPrice } from "@/lib/format";
import { cn } from "@/lib/utils";

/**
 * Valid group sizes for an item: every divisor of its box quantity that is at
 * least 2, so each member gets a whole number of units. A quantity of 1 (or
 * none) yields no sizes, so that item cannot be split.
 */
export function validSplitSizes(quantity: number): number[] {
  if (!Number.isFinite(quantity) || quantity < 2) return [];
  const sizes: number[] = [];
  for (let n = 2; n <= quantity; n += 1) {
    if (quantity % n === 0) sizes.push(n);
  }
  return sizes;
}

interface SplitTypeSelectorProps {
  itemPrice: number;
  itemQuantity: number;
  value: number;
  onChange: (value: number) => void;
}

export function SplitTypeSelector({ itemPrice, itemQuantity, value, onChange }: SplitTypeSelectorProps) {
  const sizes = validSplitSizes(itemQuantity);

  return (
    <div className="flex flex-wrap gap-2" role="radiogroup" aria-label="Split between how many people">
      {sizes.map((people) => {
        const selected = value === people;
        const units = itemQuantity / people;
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
              {formatPrice(itemPrice / people)} each, {units} {units === 1 ? "unit" : "units"}
            </span>
          </button>
        );
      })}
    </div>
  );
}
