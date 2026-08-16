import { Input, Label } from "cornell-craves";

export function WithLabel() {
  return (
    <div style={{ maxWidth: 340 }}>
      <Label htmlFor="netid">NetID</Label>
      <Input id="netid" placeholder="abc123" defaultValue="cn284" />
    </div>
  );
}

export function Placeholder() {
  return (
    <div style={{ maxWidth: 340 }}>
      <Label htmlFor="title">Title</Label>
      <Input id="title" placeholder="Dozen drop outside Duffield" />
    </div>
  );
}

export function Invalid() {
  return (
    <div style={{ maxWidth: 340 }}>
      <Label htmlFor="email">Cornell email</Label>
      <Input id="email" type="email" defaultValue="not-an-email" invalid />
      <p className="mt-1.5 text-xs font-medium text-accent">Enter a valid email address.</p>
    </div>
  );
}

export function ReadOnlyAndDisabled() {
  return (
    <div style={{ display: "grid", gap: 16, maxWidth: 340 }}>
      <div>
        <Label htmlFor="from-account">Name</Label>
        <Input id="from-account" defaultValue="Casey Nguyen" readOnly className="bg-surface" />
        <p className="mt-1.5 text-xs text-ink-muted">From your account.</p>
      </div>
      <div>
        <Label htmlFor="pct">Percent donated</Label>
        <Input id="pct" defaultValue="50" disabled className="w-20 font-mono" />
      </div>
    </div>
  );
}
