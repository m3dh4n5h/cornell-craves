export function isMobileDevice(): boolean {
  return /Android|iPhone/.test(navigator.userAgent);
}

function cleanHandle(handle: string): string {
  return handle.trim().replace(/^@/, "");
}

export function venmoUrl(handle: string, note: string, amount?: number): string {
  const recipient = cleanHandle(handle);
  if (isMobileDevice()) {
    // The app deep link supports pre-filling the amount; the web profile does not.
    const amountParam =
      amount && amount > 0 ? `&amount=${encodeURIComponent(amount.toFixed(2))}` : "";
    return `venmo://payto?recipients=${encodeURIComponent(recipient)}&note=${encodeURIComponent(note)}${amountParam}`;
  }
  return `https://venmo.com/${encodeURIComponent(recipient)}`;
}

export function openVenmo(handle: string, note: string, amount?: number): void {
  const url = venmoUrl(handle, note, amount);
  if (isMobileDevice()) {
    window.location.href = url;
  } else {
    window.open(url, "_blank", "noopener,noreferrer");
  }
}
