import {
  Carrot,
  Leaf,
  MilkOff,
  MoonStar,
  NutOff,
  Star,
  WheatOff,
  type LucideIcon,
} from "lucide-react";
import type { DietaryTagId, ListingItem } from "@/types/database";

export interface DietaryTagMeta {
  label: string;
  Icon: LucideIcon;
  className: string;
}

/**
 * Icon + color pairs, never color alone. One icon family (lucide) across the
 * whole app; every icon ships with an aria-label fallback via AllergenIcon.
 */
export const DIETARY_TAGS: Record<DietaryTagId, DietaryTagMeta> = {
  vegan: { label: "Vegan", Icon: Leaf, className: "bg-tag-green text-ink" },
  vegetarian: { label: "Vegetarian", Icon: Carrot, className: "bg-tag-green/60 text-ink" },
  halal: { label: "Halal", Icon: MoonStar, className: "bg-tag-amber text-ink" },
  kosher: { label: "Kosher", Icon: Star, className: "bg-tag-violet text-ink" },
  "gluten-free": { label: "Gluten-free", Icon: WheatOff, className: "bg-tag-wheat text-ink" },
  "nut-free": { label: "Nut-free", Icon: NutOff, className: "bg-tag-rust text-ink" },
  "dairy-free": { label: "Dairy-free", Icon: MilkOff, className: "bg-tag-blue text-ink" },
};

export const DIETARY_TAG_IDS = Object.keys(DIETARY_TAGS) as DietaryTagId[];

export function isDietaryTagId(value: string): value is DietaryTagId {
  return value in DIETARY_TAGS;
}

/** Union of dietary tags across a listing's items, in registry order. */
export function listingDietaryTags(items: ListingItem[] | null): DietaryTagId[] {
  if (!items) return [];
  const present = new Set<DietaryTagId>();
  for (const item of items) {
    for (const tag of item.dietary_tags ?? []) {
      if (isDietaryTagId(tag)) present.add(tag);
    }
  }
  return DIETARY_TAG_IDS.filter((tag) => present.has(tag));
}
