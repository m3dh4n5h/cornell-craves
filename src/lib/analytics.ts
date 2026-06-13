import { supabase } from "@/lib/supabase";

/**
 * Fire-and-forget event tracking. Views are deduplicated per browser session
 * so refreshes do not inflate counts; Venmo clicks always count.
 */
export function trackListingView(listingId: string): void {
  const key = `craves:viewed:${listingId}`;
  try {
    if (sessionStorage.getItem(key)) return;
    sessionStorage.setItem(key, "1");
  } catch {
    // Storage unavailable (private mode): still track the view.
  }
  void supabase
    .rpc("track_event", { p_listing_id: listingId, p_event_type: "view" })
    .then(({ error }) => {
      if (error) console.warn("view tracking failed:", error.message);
    });
}

export function trackVenmoClick(listingId: string): void {
  void supabase
    .rpc("track_event", { p_listing_id: listingId, p_event_type: "venmo_click" })
    .then(({ error }) => {
      if (error) console.warn("click tracking failed:", error.message);
    });
}
