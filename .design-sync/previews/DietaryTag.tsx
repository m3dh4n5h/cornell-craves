import { DietaryTag } from "cornell-craves";

const ALL = ["vegan", "vegetarian", "halal", "kosher", "gluten-free", "nut-free", "dairy-free"] as const;

export function AllTags() {
  return (
    <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
      {ALL.map((tag) => (
        <DietaryTag key={tag} tag={tag} />
      ))}
    </div>
  );
}

/** Icon-only circles for tight card layouts; the label stays available to AT. */
export function Compact() {
  return (
    <div style={{ display: "flex", flexWrap: "wrap", gap: 8, alignItems: "center" }}>
      {ALL.map((tag) => (
        <DietaryTag key={tag} tag={tag} compact />
      ))}
    </div>
  );
}

export function OnAListing() {
  return (
    <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
      <DietaryTag tag="vegetarian" />
      <DietaryTag tag="nut-free" />
    </div>
  );
}
