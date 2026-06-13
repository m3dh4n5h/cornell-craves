import { useEffect, useState } from "react";
import QRCode from "qrcode";
import { cn } from "@/lib/utils";

interface QRCodeViewProps {
  token: string;
  label: string;
  /** Renders the pass grayed out and unscannable-looking (proxy disabled). */
  disabled?: boolean;
}

/**
 * Renders a signed pickup token as a QR image. Colors are literal hex on
 * purpose: scanner contrast must not follow the theme, and the qrcode encoder
 * only accepts hex.
 */
export function QRCodeView({ token, label, disabled = false }: QRCodeViewProps) {
  const [dataUrl, setDataUrl] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    QRCode.toDataURL(token, {
      width: 480,
      margin: 1,
      errorCorrectionLevel: "M",
      color: { dark: "#16181f", light: "#ffffff" },
    })
      .then((url) => {
        if (!cancelled) setDataUrl(url);
      })
      .catch(() => {
        if (!cancelled) setDataUrl(null);
      });
    return () => {
      cancelled = true;
    };
  }, [token]);

  return (
    <figure className="inline-flex flex-col items-center">
      <div
        className={cn(
          "relative overflow-hidden rounded-2xl border border-border bg-surface-raised p-3",
          disabled && "opacity-40 grayscale",
        )}
      >
        {dataUrl ? (
          <img
            src={dataUrl}
            alt={`${label} QR pickup pass`}
            width={192}
            height={192}
            loading="lazy"
            className="aspect-square size-48"
          />
        ) : (
          <div className="size-48 animate-pulse rounded-lg bg-border/50" aria-hidden="true" />
        )}
        {disabled && (
          <span className="absolute inset-0 flex items-center justify-center">
            <span className="rounded-full bg-ink px-3 py-1 text-xs font-bold text-surface-raised">
              Disabled
            </span>
          </span>
        )}
      </div>
      <figcaption className="mt-2 text-xs font-semibold text-ink-muted">{label}</figcaption>
    </figure>
  );
}
