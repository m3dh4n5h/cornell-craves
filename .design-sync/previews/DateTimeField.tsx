import { DateTimeField, Label } from "cornell-craves";

export function DateAndTime() {
  return (
    <div style={{ maxWidth: 340 }}>
      <Label htmlFor="ends-at">Ends at</Label>
      <DateTimeField id="ends-at" defaultValue="2026-09-18T19:00" />
    </div>
  );
}

export function DateOnly() {
  return (
    <div style={{ maxWidth: 340 }}>
      <Label htmlFor="first-run">First run date (optional)</Label>
      <DateTimeField id="first-run" type="date" defaultValue="2026-09-18" />
    </div>
  );
}

export function SlotRange() {
  return (
    <div style={{ display: "flex", gap: 12, flexWrap: "wrap", maxWidth: 420 }}>
      <div style={{ flex: "1 1 180px" }}>
        <Label htmlFor="slot-start">Starts</Label>
        <DateTimeField id="slot-start" defaultValue="2026-09-18T16:00" />
      </div>
      <div style={{ flex: "1 1 180px" }}>
        <Label htmlFor="slot-end">Ends</Label>
        <DateTimeField id="slot-end" defaultValue="2026-09-18T19:00" />
      </div>
    </div>
  );
}

export function Invalid() {
  return (
    <div style={{ maxWidth: 340 }}>
      <Label htmlFor="expired-at">Ends at</Label>
      <DateTimeField id="expired-at" defaultValue="2024-01-04T12:00" invalid />
      <p className="mt-1.5 text-xs font-medium text-accent">The end time has to be in the future.</p>
    </div>
  );
}
