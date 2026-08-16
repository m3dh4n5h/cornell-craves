import { Input, Label, Textarea } from "cornell-craves";

export function OnField() {
  return (
    <div style={{ maxWidth: 340 }}>
      <Label htmlFor="brand-field">Brand</Label>
      <Input id="brand-field" placeholder="Krispy Kreme" />
    </div>
  );
}

export function WithHelpText() {
  return (
    <div style={{ maxWidth: 340 }}>
      <Label htmlFor="contact-field">Contact email</Label>
      <Input id="contact-field" type="email" placeholder="club-officer@cornell.edu" />
      <p className="mt-1.5 text-xs text-ink-muted">
        Shown on this listing so buyers can reach you about it.
      </p>
    </div>
  );
}

export function OnTextarea() {
  return (
    <div style={{ maxWidth: 340 }}>
      <Label htmlFor="desc-field">Description (optional)</Label>
      <Textarea id="desc-field" placeholder="What are you raising money for?" />
    </div>
  );
}
