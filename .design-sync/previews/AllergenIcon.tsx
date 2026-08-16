import { AllergenIcon } from "cornell-craves";

const ALL = ["vegan", "vegetarian", "halal", "kosher", "gluten-free", "nut-free", "dairy-free"] as const;

export function AllTags() {
  return (
    <div style={{ display: "flex", flexWrap: "wrap", gap: 14, alignItems: "center" }}>
      {ALL.map((tag) => (
        <AllergenIcon key={tag} tag={tag} size="md" withBg />
      ))}
    </div>
  );
}

export function Sizes() {
  return (
    <div style={{ display: "flex", gap: 16, alignItems: "center" }}>
      <AllergenIcon tag="vegan" size="sm" withBg />
      <AllergenIcon tag="vegan" size="md" withBg />
    </div>
  );
}

/** How it appears in the order form: inline, unbacked, next to the item name. */
export function InlineWithItem() {
  return (
    <p className="flex flex-wrap items-center gap-x-1.5 text-sm font-semibold">
      <AllergenIcon tag="vegetarian" className="text-ink-muted" />
      <AllergenIcon tag="nut-free" className="text-ink-muted" />
      <span>Glazed dozen</span>
      <span className="text-xs font-normal text-ink-muted">· 12 in a box</span>
    </p>
  );
}
