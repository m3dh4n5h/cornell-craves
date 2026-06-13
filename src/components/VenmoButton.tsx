import { ArrowUpRight } from "lucide-react";
import { openVenmo } from "@/lib/venmo";
import { Button } from "@/components/ui/button";

interface VenmoButtonProps {
  handle: string | null;
  note: string;
  disabled?: boolean;
  /** Fires right before the Venmo deep link opens (analytics hook). */
  onPay?: () => void;
}

export function VenmoButton({ handle, note, disabled = false, onPay }: VenmoButtonProps) {
  if (!handle) {
    return (
      <Button size="lg" className="w-full" disabled>
        Venmo not set up
      </Button>
    );
  }

  const display = handle.startsWith("@") ? handle : `@${handle}`;

  return (
    <div>
      <Button
        size="lg"
        className="w-full"
        disabled={disabled}
        onClick={() => {
          onPay?.();
          openVenmo(handle, note);
        }}
      >
        Pay with Venmo
        <ArrowUpRight className="size-4" aria-hidden="true" />
      </Button>
      <p className="mt-2 text-center font-mono text-xs text-ink-muted">{display}</p>
    </div>
  );
}
