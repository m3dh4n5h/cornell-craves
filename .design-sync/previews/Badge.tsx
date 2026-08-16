import { Badge } from "cornell-craves";
import { BadgeCheck, Hourglass } from "lucide-react";

export function Variants() {
  return (
    <div style={{ display: "flex", flexWrap: "wrap", gap: 8, alignItems: "center" }}>
      <Badge variant="default">Draft</Badge>
      <Badge variant="success">Live</Badge>
      <Badge variant="urgent">Ended</Badge>
      <Badge variant="neutral">Posts on approval</Badge>
    </div>
  );
}

export function OrderStatuses() {
  return (
    <div style={{ display: "flex", flexWrap: "wrap", gap: 8, alignItems: "center" }}>
      <Badge variant="urgent">3 owe payment</Badge>
      <Badge variant="success">QR pass sent</Badge>
      <Badge variant="neutral">Awaiting brand</Badge>
      <Badge variant="success">Picked up</Badge>
    </div>
  );
}

export function WithIcons() {
  return (
    <div style={{ display: "flex", flexWrap: "wrap", gap: 8, alignItems: "center" }}>
      <Badge variant="success">
        <BadgeCheck className="size-3" aria-hidden="true" />
        Krispy Kreme
      </Badge>
      <Badge variant="neutral">
        <Hourglass className="size-3" aria-hidden="true" />
        Levain Bakery
      </Badge>
    </div>
  );
}
