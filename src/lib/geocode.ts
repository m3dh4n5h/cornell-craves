/**
 * Free address geocoding via OpenStreetMap Nominatim (no API key).
 *
 * Usage policy (https://operations.osmfoundation.org/policies/nominatim/):
 * low volume only, max ~1 request/second, identify the app. Browsers can't set
 * a custom User-Agent, but send a Referer that identifies the site, which is
 * acceptable for the occasional club-adds-a-spot call. Callers should debounce
 * and only fire on an explicit button press, not on every keystroke.
 */
export interface GeocodeResult {
  lat: number;
  lng: number;
  displayName: string;
}

export async function geocodeAddress(address: string): Promise<GeocodeResult | null> {
  const url = new URL("https://nominatim.openstreetmap.org/search");
  url.searchParams.set("q", address);
  url.searchParams.set("format", "jsonv2");
  url.searchParams.set("limit", "1");
  // Bias toward Ithaca / Cornell so a bare building name resolves locally.
  url.searchParams.set("viewbox", "-76.52,42.48,-76.45,42.42");
  url.searchParams.set("bounded", "0");

  try {
    const response = await fetch(url, { headers: { Accept: "application/json" } });
    if (!response.ok) return null;
    const data = (await response.json()) as Array<{ lat: string; lon: string; display_name: string }>;
    if (!Array.isArray(data) || data.length === 0) return null;
    const top = data[0];
    const lat = Number(top.lat);
    const lng = Number(top.lon);
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
    return { lat, lng, displayName: top.display_name };
  } catch {
    // Offline, DNS failure, or the request was blocked outright: treat it the
    // same as "couldn't find it" rather than an unhandled rejection, so the
    // caller's loading state always resolves.
    return null;
  }
}

/** ~300m-wide box around a point, for a close-in single-pin preview. */
const PREVIEW_SPAN = 0.003;

/**
 * An embeddable OpenStreetMap preview (an iframe, no JS map library, no API
 * key) so a club can SEE the pin before saving a new spot, not just trust the
 * geocoder's first guess.
 */
export function osmEmbedUrl(lat: number, lng: number): string {
  const bbox = [lng - PREVIEW_SPAN, lat - PREVIEW_SPAN, lng + PREVIEW_SPAN, lat + PREVIEW_SPAN].join(",");
  return `https://www.openstreetmap.org/export/embed.html?bbox=${bbox}&layer=mapnik&marker=${lat},${lng}`;
}

/** Full-size OpenStreetMap view for the "open in a new tab" link. */
export function osmViewUrl(lat: number, lng: number): string {
  return `https://www.openstreetmap.org/?mlat=${lat}&mlon=${lng}#map=18/${lat}/${lng}`;
}
