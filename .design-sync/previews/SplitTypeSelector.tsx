import { useState } from "react";
import { Label, SplitTypeSelector } from "cornell-craves";

/**
 * Only divisors of the box quantity are offered, so every member gets whole
 * units. A dozen yields 2/3/4/6/12; a 4-pack yields only 2 and 4.
 */
function Demo({ price, quantity, initial }: { price: number; quantity: number; initial: number }) {
  const [value, setValue] = useState(initial);
  return (
    <div style={{ maxWidth: 460 }}>
      <Label>Split how many ways?</Label>
      <SplitTypeSelector itemPrice={price} itemQuantity={quantity} value={value} onChange={setValue} />
      <p className="mt-1.5 text-xs text-ink-muted">
        Each person pays ${(price / value).toFixed(2)} and takes home {quantity / value} of {quantity} units.
      </p>
    </div>
  );
}

/** A dozen: the full set of even splits. */
export function Dozen() {
  return <Demo price={14.99} quantity={12} initial={4} />;
}

/** A party box, split three ways. */
export function PartyBox() {
  return <Demo price={34.99} quantity={12} initial={3} />;
}

/** A small box: only two options are valid. */
export function FourPack() {
  return <Demo price={15.99} quantity={4} initial={2} />;
}
