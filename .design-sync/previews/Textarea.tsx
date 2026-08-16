import { Label, Textarea } from "cornell-craves";

export function WithLabel() {
  return (
    <div style={{ maxWidth: 380 }}>
      <Label htmlFor="drop-desc">Description (optional)</Label>
      <Textarea
        id="drop-desc"
        className="min-h-28"
        defaultValue="Fresh from the Syracuse store that morning. Every box helps send our team to nationals, and a fifth of it goes to a local food pantry."
      />
    </div>
  );
}

export function Placeholder() {
  return (
    <div style={{ maxWidth: 380 }}>
      <Label htmlFor="drop-desc-empty">Description (optional)</Label>
      <Textarea
        id="drop-desc-empty"
        className="min-h-28"
        placeholder="What are you raising money for? Any flavors or limits worth knowing?"
      />
    </div>
  );
}

export function Invalid() {
  return (
    <div style={{ maxWidth: 380 }}>
      <Label htmlFor="hours-note">Hours per day (spans multiple days)</Label>
      <Textarea id="hours-note" className="min-h-16" invalid placeholder={"Mon Jun 16: 11am-2pm"} />
      <p className="mt-1.5 text-xs font-medium text-accent">
        Add the per-day hours for a window spanning multiple days.
      </p>
    </div>
  );
}
