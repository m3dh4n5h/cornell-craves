import { Map as MapGL, Marker } from "react-map-gl/maplibre";
import { MapPin } from "lucide-react";
import "maplibre-gl/dist/maplibre-gl.css";

/**
 * A single-pin map, used to confirm a geocoded address before it is saved as a
 * pickup spot.
 *
 * This used to be an <iframe> pointing at openstreetmap.org/export/embed.html.
 * That silently stopped rendering: the app's Content-Security-Policy (see
 * vercel.json) declares no `frame-src`, so framing falls back to `default-src
 * 'self'` and the browser blocks the embed outright, leaving the club staring
 * at "This content is blocked" while being asked to confirm a pin it cannot
 * see. Rather than widen the CSP for one preview, this draws the pin with the
 * MapLibre/OpenFreeMap stack the Map page already uses, whose tiles, sprites
 * and glyphs are already allowed by `img-src` and `connect-src`. Same pin, no
 * third-party frame, and the preview now looks like the rest of the app.
 */
export function SpotMapPreview({
  latitude,
  longitude,
  label,
  className = "h-44 w-full",
}: {
  latitude: number;
  longitude: number;
  label: string;
  className?: string;
}) {
  return (
    <div className={className} role="img" aria-label={`Map showing ${label}`}>
      <MapGL
        // Keyed on the coordinates so searching again re-centres rather than
        // leaving the previous candidate's pin on screen.
        key={`${latitude},${longitude}`}
        initialViewState={{ latitude, longitude, zoom: 16.5 }}
        mapStyle="https://tiles.openfreemap.org/styles/liberty"
        style={{ width: "100%", height: "100%" }}
        // A confirmation preview, not a map to explore: dragging or zooming it
        // cannot change which coordinates get saved, so leave it still.
        interactive={false}
      >
        <Marker longitude={longitude} latitude={latitude} anchor="bottom">
          <MapPin
            className="size-8 drop-shadow-sm"
            strokeWidth={2.5}
            style={{ color: "var(--color-primary-dark)" }}
            aria-hidden="true"
          />
        </Marker>
      </MapGL>
    </div>
  );
}
