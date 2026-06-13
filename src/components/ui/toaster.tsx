import type { CSSProperties } from "react";
import { Toaster as SonnerToaster } from "sonner";

export function Toaster() {
  return (
    <SonnerToaster
      position="bottom-center"
      offset={16}
      gap={8}
      style={{ zIndex: "var(--z-toast)" } as CSSProperties}
      toastOptions={{
        duration: 3500,
        style: {
          background: "var(--color-surface-raised)",
          color: "var(--color-ink)",
          border: "1px solid var(--color-border)",
          borderRadius: "1rem",
          fontFamily: "var(--font-body)",
          fontSize: "0.9375rem",
          boxShadow: "0 4px 16px oklch(18% 0.02 260 / 0.08)",
        },
      }}
    />
  );
}
