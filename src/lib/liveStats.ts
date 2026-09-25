import { supabase } from "@/lib/supabase";
import type { ListingWithClub } from "@/types/database";

/** listing_stock / listing_fundraising cap each call at 200 ids. */
const RPC_BATCH = 200;

function chunks<T>(values: T[]): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < values.length; i += RPC_BATCH) out.push(values.slice(i, i + RPC_BATCH));
  return out;
}

/**
 * Merge live stock and fundraising counts into listings. Only drops that use
 * the features are queried. On any error the listings come back unchanged, so
 * the page still renders (the order RPC enforces stock regardless).
 */
export async function withLiveStats(listings: ListingWithClub[]): Promise<ListingWithClub[]> {
  const stockIds = listings
    .filter((listing) => (listing.items ?? []).some((item) => item.stock != null))
    .map((listing) => listing.id);
  const goalIds = listings.filter((listing) => listing.goal_amount != null).map((listing) => listing.id);
  if (stockIds.length === 0 && goalIds.length === 0) return listings;

  const [stockResults, goalResults] = await Promise.all([
    Promise.all(chunks(stockIds).map((ids) => supabase.rpc("listing_stock", { p_listing_ids: ids }))),
    Promise.all(chunks(goalIds).map((ids) => supabase.rpc("listing_fundraising", { p_listing_ids: ids }))),
  ]);

  const stockLeft = new Map<string, Record<string, number>>();
  for (const { data, error } of stockResults) {
    if (error) {
      console.warn("stock counts unavailable:", error.message);
      continue;
    }
    for (const row of data ?? []) {
      const entry = stockLeft.get(row.listing_id) ?? {};
      entry[row.item_name] = Number(row.remaining);
      stockLeft.set(row.listing_id, entry);
    }
  }

  const raised = new Map<string, number>();
  for (const { data, error } of goalResults) {
    if (error) {
      console.warn("fundraising totals unavailable:", error.message);
      continue;
    }
    for (const row of data ?? []) raised.set(row.listing_id, Number(row.raised));
  }

  return listings.map((listing) => {
    const left = stockLeft.get(listing.id);
    const total = raised.get(listing.id);
    if (!left && total === undefined) return listing;
    return {
      ...listing,
      ...(left ? { stock_left: left } : {}),
      ...(total !== undefined ? { goal_raised: total } : {}),
    };
  });
}
