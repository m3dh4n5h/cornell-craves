import { useEffect, useRef, useState } from "react";
import { Combobox, Label } from "cornell-craves";

const BRANDS = [
  "Krispy Kreme",
  "Crumbl",
  "Chick-fil-A",
  "Insomnia Cookies",
  "Texas Roadhouse",
  "Auntie Anne's",
  "Wingstop",
  "Shake Shack",
];

/** Controlled wrapper: Combobox takes value + onChange, so a live cell needs state. */
function Demo({ initial = "", ...rest }: { initial?: string; [key: string]: unknown }) {
  const [value, setValue] = useState(initial);
  return (
    <div style={{ maxWidth: 340 }}>
      <Label htmlFor="brand-demo">Brand</Label>
      <Combobox
        id="brand-demo"
        value={value}
        onChange={setValue}
        options={BRANDS}
        placeholder="Krispy Kreme"
        emptyHint="Not in the list yet. Keep typing, then request it below."
        {...rest}
      />
    </div>
  );
}

export function Empty() {
  return <Demo />;
}

/**
 * The suggestion list is what distinguishes this from a plain Input, and it
 * only appears on focus, so the cell focuses the field on mount to show it.
 */
export function OpenWithSuggestions() {
  const host = useRef<HTMLDivElement>(null);
  const [value, setValue] = useState("k");
  useEffect(() => {
    host.current?.querySelector("input")?.focus();
  }, []);
  return (
    <div ref={host} style={{ maxWidth: 340, minHeight: 260 }}>
      <Label htmlFor="brand-open">Brand</Label>
      <Combobox
        id="brand-open"
        value={value}
        onChange={setValue}
        options={BRANDS}
        placeholder="Krispy Kreme"
        emptyHint="Not in the list yet. Keep typing, then request it below."
      />
    </div>
  );
}

export function Selected() {
  return <Demo initial="Krispy Kreme" />;
}

export function Invalid() {
  return <Demo invalid />;
}
