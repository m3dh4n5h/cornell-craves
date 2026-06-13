import { useState, type KeyboardEvent } from "react";
import { Star } from "lucide-react";
import { cn } from "@/lib/utils";

const SIZE_CLASSES = {
  sm: "size-3.5",
  md: "size-5",
  lg: "size-7",
} as const;

interface RatingStarsProps {
  value: number;
  /** Providing onChange switches to interactive input mode. */
  onChange?: (value: number) => void;
  size?: keyof typeof SIZE_CLASSES;
  className?: string;
}

function StarRow({ size, filled }: { size: keyof typeof SIZE_CLASSES; filled: boolean }) {
  return (
    <span className={cn("flex gap-0.5", filled ? "text-primary" : "text-border")}>
      {Array.from({ length: 5 }, (_, index) => (
        <Star
          key={index}
          className={SIZE_CLASSES[size]}
          fill="currentColor"
          strokeWidth={0}
          aria-hidden="true"
        />
      ))}
    </span>
  );
}

export function RatingStars({ value, onChange, size = "md", className }: RatingStarsProps) {
  const [hovered, setHovered] = useState(0);

  // Read-only display with partial fill (e.g. 4.3 stars).
  if (!onChange) {
    const clamped = Math.max(0, Math.min(5, value));
    return (
      <span
        className={cn("relative inline-flex", className)}
        role="img"
        aria-label={`${clamped.toFixed(1)} out of 5 stars`}
      >
        <StarRow size={size} filled={false} />
        <span
          className="absolute inset-0 overflow-hidden"
          style={{ width: `${(clamped / 5) * 100}%` }}
          aria-hidden="true"
        >
          <StarRow size={size} filled />
        </span>
      </span>
    );
  }

  // Interactive input. Keyboard: arrows adjust, Home/End jump. The fill
  // reveals left to right (40ms per star, 200ms total). Keyboard changes are
  // applied instantly, hover effects only fire on fine pointers.
  const shown = hovered || value;

  const handleKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    let next = value;
    if (event.key === "ArrowRight" || event.key === "ArrowUp") next = Math.min(5, value + 1);
    else if (event.key === "ArrowLeft" || event.key === "ArrowDown") next = Math.max(1, value - 1);
    else if (event.key === "Home") next = 1;
    else if (event.key === "End") next = 5;
    else return;
    event.preventDefault();
    onChange(next);
  };

  return (
    <div
      role="radiogroup"
      aria-label="Rating"
      className={cn("flex gap-0.5", className)}
      onKeyDown={handleKeyDown}
      onMouseLeave={() => setHovered(0)}
    >
      {Array.from({ length: 5 }, (_, index) => {
        const starValue = index + 1;
        const filled = starValue <= shown;
        return (
          <button
            key={starValue}
            type="button"
            role="radio"
            aria-checked={value === starValue}
            aria-label={`${starValue} ${starValue === 1 ? "star" : "stars"}`}
            tabIndex={value === starValue || (value === 0 && starValue === 1) ? 0 : -1}
            onClick={() => onChange(starValue)}
            onMouseEnter={() => setHovered(starValue)}
            className={cn(
              "rounded-md transition-transform duration-150 [transition-timing-function:var(--ease-out)] hover-fine:scale-110 active:scale-95",
              filled ? "text-primary" : "text-border",
            )}
          >
            <Star
              className={cn(
                SIZE_CLASSES[size],
                "transition-colors duration-100 [transition-timing-function:var(--ease-out)]",
              )}
              style={{ transitionDelay: filled ? `${index * 40}ms` : "0ms" }}
              fill="currentColor"
              strokeWidth={0}
              aria-hidden="true"
            />
          </button>
        );
      })}
    </div>
  );
}
