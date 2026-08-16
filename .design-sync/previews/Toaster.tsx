import { useEffect } from "react";
import { Toaster, toast } from "cornell-craves";

/**
 * Toaster renders the notification host and stays empty until something fires a
 * toast, so each cell raises one on mount. Mount Toaster once near the app root;
 * call toast() from anywhere in the tree.
 *
 * Two preview-only details: the host positions itself `fixed`, so the wrapper
 * takes a `transform` to become its containing block and keep the toast inside
 * the card; and the toast is given an infinite duration so it does not expire
 * before the screenshot.
 */
function Host({ fire }: { fire: () => void }) {
  useEffect(fire, [fire]);
  return (
    <div
      style={{
        transform: "translateZ(0)",
        position: "relative",
        minHeight: 150,
        width: "100%",
        maxWidth: 420,
      }}
    >
      <Toaster />
    </div>
  );
}

export function Success() {
  return (
    <Host
      fire={() => {
        toast.success("Payment verified. QR pass emailed.", { duration: Infinity });
      }}
    />
  );
}

export function ErrorToast() {
  return (
    <Host
      fire={() => {
        toast.error("Check the highlighted fields.", { duration: Infinity });
      }}
    />
  );
}

export function Informational() {
  return (
    <Host
      fire={() => {
        toast("Draft saved. Publish it once the brand is approved.", { duration: Infinity });
      }}
    />
  );
}
