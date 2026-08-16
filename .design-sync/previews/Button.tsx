import { Button } from "cornell-craves";
import { Plus, ArrowUpRight, Trash2 } from "lucide-react";

export function Variants() {
  return (
    <div style={{ display: "flex", flexWrap: "wrap", gap: 12, alignItems: "center" }}>
      <Button variant="primary">Order items</Button>
      <Button variant="secondary">Save as draft</Button>
      <Button variant="ghost">Cancel</Button>
      <Button variant="destructive">End drop now</Button>
    </div>
  );
}

export function Sizes() {
  return (
    <div style={{ display: "flex", flexWrap: "wrap", gap: 12, alignItems: "center" }}>
      <Button size="sm">Verify payment</Button>
      <Button size="md">Verify payment</Button>
      <Button size="lg">Verify payment</Button>
    </div>
  );
}

export function WithIcons() {
  return (
    <div style={{ display: "flex", flexWrap: "wrap", gap: 12, alignItems: "center" }}>
      <Button>
        <Plus className="size-4" aria-hidden="true" />
        New listing
      </Button>
      <Button variant="secondary">
        Pay with Venmo
        <ArrowUpRight className="size-4" aria-hidden="true" />
      </Button>
      <Button variant="ghost">
        <Trash2 className="size-3.5" aria-hidden="true" />
        Delete draft
      </Button>
    </div>
  );
}

export function States() {
  return (
    <div style={{ display: "flex", flexWrap: "wrap", gap: 12, alignItems: "center" }}>
      <Button loading>Publishing drop</Button>
      <Button disabled>Sold out</Button>
      <Button variant="secondary" loading>
        Verifying
      </Button>
    </div>
  );
}
