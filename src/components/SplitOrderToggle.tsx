import { Users } from "lucide-react";

interface SplitOrderToggleProps {
  enabled: boolean;
  onChange: (enabled: boolean) => void;
}

export function SplitOrderToggle({ enabled, onChange }: SplitOrderToggleProps) {
  return (
    <label className="flex min-h-11 cursor-pointer items-center justify-between gap-3 rounded-2xl border border-border bg-surface-raised p-4">
      <span className="flex items-start gap-3">
        <Users className="mt-0.5 size-5 shrink-0 text-primary-dark" aria-hidden="true" />
        <span>
          <span className="block text-sm font-bold">Split this order</span>
          <span className="block text-xs text-ink-muted">
            Pick one item, split the cost with 2 to 4 people. Everyone pays their share and
            gets their own QR pass.
          </span>
        </span>
      </span>
      <input
        type="checkbox"
        checked={enabled}
        onChange={(e) => onChange(e.target.checked)}
        className="size-5 shrink-0 accent-(--color-primary-dark)"
        aria-label="Split this order with friends"
      />
    </label>
  );
}
