import { LayoutGroup, motion, useReducedMotion } from "framer-motion";
import { cn } from "@/lib/utils";

interface BrandFilterProps {
  brands: string[];
  selected: string | null;
  onSelect: (brand: string | null) => void;
}

export function BrandFilter({ brands, selected, onSelect }: BrandFilterProps) {
  const reduceMotion = useReducedMotion();
  const options: Array<string | null> = [null, ...brands];

  return (
    <LayoutGroup id="brand-filter">
      <div
        className="-mx-4 flex gap-2 overflow-x-auto px-4 pb-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
        role="radiogroup"
        aria-label="Filter listings by brand"
      >
        {options.map((brand) => {
          const isActive = selected === brand;
          const label = brand ?? "All";
          return (
            <button
              key={label}
              type="button"
              role="radio"
              aria-checked={isActive}
              onClick={() => onSelect(brand)}
              className={cn(
                "relative shrink-0 whitespace-nowrap rounded-full px-4 py-2 text-sm font-semibold transition-colors duration-150 [transition-timing-function:var(--ease-out)] active:scale-[0.97]",
                isActive ? "text-surface-raised" : "text-ink hover-fine:bg-ink/10",
              )}
            >
              {isActive &&
                (reduceMotion ? (
                  <span className="absolute inset-0 rounded-full bg-ink" aria-hidden="true" />
                ) : (
                  <motion.span
                    layoutId="brand-filter-pill"
                    className="absolute inset-0 rounded-full bg-ink"
                    transition={{ type: "tween", duration: 0.25, ease: [0.23, 1, 0.32, 1] }}
                    aria-hidden="true"
                  />
                ))}
              <span className="z-raised relative">{label}</span>
            </button>
          );
        })}
      </div>
    </LayoutGroup>
  );
}
