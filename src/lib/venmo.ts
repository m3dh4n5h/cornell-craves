export function isMobileDevice(): boolean {
  return /Android|iPhone/.test(navigator.userAgent);
}

function cleanHandle(handle: string): string {
  return handle.trim().replace(/^@/, "");
}

export function venmoUrl(handle: string, note: string): string {
  const recipient = cleanHandle(handle);
  if (isMobileDevice()) {
    return `venmo://payto?recipients=${encodeURIComponent(recipient)}&note=${encodeURIComponent(note)}`;
  }
  return `https://venmo.com/${encodeURIComponent(recipient)}`;
}

export function openVenmo(handle: string, note: string): void {
  const url = venmoUrl(handle, note);
  if (isMobileDevice()) {
    window.location.href = url;
  } else {
    window.open(url, "_blank", "noopener,noreferrer");
  }
}
