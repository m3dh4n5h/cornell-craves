import { DIETARY_TAGS } from "@/lib/dietary";
import type { DietaryTagId } from "@/types/database";
import { cn } from "@/lib/utils";

interface AllergenIconProps {
  tag: DietaryTagId;
  /** sm = inline next to item names, md = standalone chip contexts. */
  size?: "sm" | "md";
  /** Adds the tag's tinted circle behind the icon. */
  withBg?: boolean;
  className?: string;
}

/**
 * Bare allergen/dietary icon with an aria-label fallback. Same size and
 * position everywhere an item name appears.
 */
export function AllergenIcon({ tag, size = "sm", withBg = false, className }: AllergenIconProps) {
  const meta = DIETARY_TAGS[tag];
  const Icon = meta.Icon;

  if (withBg) {
    return (
      <span
        className={cn(
          "inline-flex items-center justify-center rounded-full",
          size === "sm" ? "size-6" : "size-7",
          meta.className,
          className,
        )}
        role="img"
        aria-label={meta.label}
        title={meta.label}
      >
        <Icon className={size === "sm" ? "size-3.5" : "size-4"} aria-hidden="true" />
      </span>
    );
  }

  return (
    <Icon
      className={cn(size === "sm" ? "size-3.5" : "size-4", "shrink-0", className)}
      role="img"
      aria-label={meta.label}
    />
  );
}
