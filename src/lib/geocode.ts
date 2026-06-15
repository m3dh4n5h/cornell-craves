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

  const response = await fetch(url, { headers: { Accept: "application/json" } });
  if (!response.ok) return null;
  const data = (await response.json()) as Array<{ lat: string; lon: string; display_name: string }>;
  if (!Array.isArray(data) || data.length === 0) return null;
  const top = data[0];
  const lat = Number(top.lat);
  const lng = Number(top.lon);
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
  return { lat, lng, displayName: top.display_name };
}
