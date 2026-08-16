import { VenmoButton } from "cornell-craves";

/** The pay CTA shown once an order is placed; amount pre-fills the deep link. */
export function Default() {
  return (
    <div style={{ maxWidth: 340 }}>
      <VenmoButton handle="willow-lane-dance" note="Cornell Craves: Glazed dozens outside Duffield" amount={18.49} />
    </div>
  );
}

/** Without an amount the link opens the handle with just the note. */
export function NoAmount() {
  return (
    <div style={{ maxWidth: 340 }}>
      <VenmoButton handle="silverblade-skate" note="Cornell Craves: Crumbl party box drop" />
    </div>
  );
}

/** Disabled once the drop has ended. */
export function Disabled() {
  return (
    <div style={{ maxWidth: 340 }}>
      <VenmoButton handle="willow-lane-dance" note="Cornell Craves: Glazed dozens outside Duffield" amount={18.49} disabled />
    </div>
  );
}
