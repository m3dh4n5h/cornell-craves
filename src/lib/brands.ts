/**
 * Brands clubs commonly fundraise with around Cornell. Clubs can also type a
 * custom brand in the dashboard; the feed filter builds itself from live data.
 */
export const BRANDS = [
  "Krispy Kreme",
  "Crumbl",
  "Chick-fil-A",
  "Auntie Anne's",
  "Wingstop",
  "Shake Shack",
  "Nothing Bundt Cakes",
  "Insomnia Cookies",
  "In-N-Out",
  "Texas Roadhouse",
  "Club Bake Sale",
  "Other",
] as const;

const TINT_CLASSES = [
  "bg-tint-1",
  "bg-tint-2",
  "bg-tint-3",
  "bg-tint-4",
  "bg-tint-5",
  "bg-tint-6",
] as const;

export function brandTint(brand: string): string {
  let hash = 0;
  for (let i = 0; i < brand.length; i += 1) {
    hash = (hash * 31 + brand.charCodeAt(i)) >>> 0;
  }
  return TINT_CLASSES[hash % TINT_CLASSES.length];
}

export function brandInitials(brand: string): string {
  return brand
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((word) => word[0]!.toUpperCase())
    .join("");
}
