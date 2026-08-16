import { Label, Select } from "cornell-craves";

export function WithLabel() {
  return (
    <div style={{ maxWidth: 340 }}>
      <Label htmlFor="pickup-spot">Pickup spot for this day</Label>
      <Select id="pickup-spot" defaultValue="duffield">
        <option value="">No specific spot</option>
        <option value="duffield">Duffield Atrium</option>
        <option value="hoplaza">Ho Plaza</option>
        <option value="wsh">Willard Straight Hall</option>
        <option value="mann">Mann Library</option>
      </Select>
    </div>
  );
}

export function Placeholder() {
  return (
    <div style={{ maxWidth: 340 }}>
      <Label htmlFor="ordering">Ordering</Label>
      <Select id="ordering" defaultValue="">
        <option value="">Pick a location</option>
        <option value="preorder">Pre-order only</option>
        <option value="same_day">Same-day pickup</option>
        <option value="both">Pre-order &amp; same-day</option>
      </Select>
    </div>
  );
}

export function Invalid() {
  return (
    <div style={{ maxWidth: 340 }}>
      <Label htmlFor="recommender">Which member recommended you?</Label>
      <Select id="recommender" defaultValue="" invalid>
        <option value="">No one in particular</option>
        <option value="aarav">Aarav</option>
        <option value="priya">Priya</option>
        <option value="sam">Sam</option>
      </Select>
      <p className="mt-1.5 text-xs font-medium text-accent">Pick one to credit the member.</p>
    </div>
  );
}
