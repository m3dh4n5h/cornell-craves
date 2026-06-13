import { DIETARY_TAGS } from "@/lib/dietary";
import { AllergenIcon } from "@/components/AllergenIcon";
import type { DietaryTagId } from "@/types/database";
import { cn } from "@/lib/utils";

interface DietaryTagProps {
  tag: DietaryTagId;
  /** Icon-only circle for tight spaces (cards). Label still exposed to AT. */
  compact?: boolean;
  className?: string;
}

export function DietaryTag({ tag, compact = false, className }: DietaryTagProps) {
  const meta = DIETARY_TAGS[tag];

  if (compact) {
    return <AllergenIcon tag={tag} withBg className={className} />;
  }

  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-xs font-semibold",
        meta.className,
        className,
      )}
    >
      <meta.Icon className="size-3" aria-hidden="true" />
      {meta.label}
    </span>
  );
}
