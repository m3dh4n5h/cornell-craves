import { useEffect, useMemo, useState } from "react";
import { Check, Minus, Plus, Store } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/lib/supabase";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import { formatPrice } from "@/lib/format";
import { cn } from "@/lib/utils";
import type { ListingItem, SameDayStock } from "@/types/database";

/**
 * The club's pickup-day counter: what is left at each table, and a way to
 * record a sale made in person.
 *
 * A walk-up is written as a real order (record_walk_up_sale, migration 060),
 * not a tally. That is the whole reason it lives here rather than as a number
 * the club edits: an order row means the money reaches revenue, the
 * fundraising goal bar and the analytics page by itself, and the sale appears
 * in the CSV beside every pre-order, which is what a treasurer actually needs
 * at the end of the day. A tally would have to be reconciled by hand.
 *
 * Counts are per item PER SPOT because a club with two tables physically
 * splits its boxes between them, and "8 left" is a useless number if it does
 * not say which table.
 */
export function SameDayTable({
  listingId,
  items,
  onSold,
}: {
  listingId: string;
  items: ListingItem[];
  onSold: () => void;
}) {
  const [stock, setStock] = useState<SameDayStock[]>([]);
  const [loading, setLoading] = useState(true);
  const [spotId, setSpotId] = useState<string>("");
  const [cart, setCart] = useState<Record<string, number>>({});
  const [buyerName, setBuyerName] = useState("");
  const [buyerEmail, setBuyerEmail] = useState("");
  const [payment, setPayment] = useState("cash");
  const [saving, setSaving] = useState(false);
  const [editing, setEditing] = useState(false);
  const [counts, setCounts] = useState<Record<string, string>>({});

  const load = async () => {
    const { data, error } = await supabase.rpc("same_day_stock", { p_listing_ids: [listingId] });
    if (error) {
      toast.error(error.message);
      setLoading(false);
      return;
    }
    const rows = (data as unknown as SameDayStock[]) ?? [];
    setStock(rows);
    setSpotId((previous) => previous || rows[0]?.spot_id || "");
    setLoading(false);
  };

  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [listingId]);

  const spots = useMemo(() => {
    const seen = new Map<string, string>();
    for (const row of stock) if (!seen.has(row.spot_id)) seen.set(row.spot_id, row.location_name);
    return [...seen.entries()].map(([id, name]) => ({ id, name }));
  }, [stock]);

  const here = stock.filter((row) => row.spot_id === spotId);
  const priceOf = (name: string) =>
    Number(items.find((item) => item.name === name)?.price ?? 0);

  // Running totals. `sold` comes from the walk-up order rows themselves
  // (same_day_sold), not a counter the UI keeps, so it survives a refresh and
  // cannot drift from what the orders list and the CSV say. Money is priced
  // off the listing for the same reason.
  const totals = (rows: SameDayStock[]) =>
    rows.reduce(
      (sum, row) => ({
        brought: sum.brought + row.quantity,
        sold: sum.sold + row.sold,
        left: sum.left + row.remaining,
        collected: sum.collected + row.sold * priceOf(row.item_name),
      }),
      { brought: 0, sold: 0, left: 0, collected: 0 },
    );
  const spotTotals = totals(here);
  const allTotals = totals(stock);
  const cartTotal = Object.entries(cart).reduce(
    (sum, [name, qty]) => sum + priceOf(name) * qty,
    0,
  );
  const cartCount = Object.values(cart).reduce((sum, qty) => sum + qty, 0);

  const bump = (name: string, delta: number, remaining: number) => {
    setCart((previous) => {
      const next = Math.max(0, Math.min((previous[name] ?? 0) + delta, remaining));
      const copy = { ...previous };
      if (next === 0) delete copy[name];
      else copy[name] = next;
      return copy;
    });
  };

  const sell = async () => {
    if (cartCount === 0) {
      toast.error("Add at least one item.");
      return;
    }
    setSaving(true);
    const { error } = await supabase.rpc("record_walk_up_sale", {
      p_listing_id: listingId,
      p_spot_id: spotId,
      p_items: Object.entries(cart).map(([name, qty]) => ({ name, qty })),
      p_buyer_name: buyerName.trim() || null,
      p_buyer_email: buyerEmail.trim().toLowerCase() || null,
      p_payment_method: payment,
    });
    setSaving(false);
    if (error) {
      toast.error(error.message);
      return;
    }
    setCart({});
    setBuyerName("");
    setBuyerEmail("");
    await load();
    onSold();
    toast.success("Sale recorded. It counts toward your total and your goal.");
  };

  const saveCounts = async () => {
    setSaving(true);
    const rows = Object.entries(counts)
      .map(([name, value]) => ({ name, quantity: Number.parseInt(value, 10) }))
      .filter((row) => Number.isFinite(row.quantity) && row.quantity >= 0);
    const { error } = await supabase.from("listing_same_day_stock").upsert(
      rows.map((row) => ({
        listing_id: listingId,
        spot_id: spotId,
        item_name: row.name,
        quantity: row.quantity,
        updated_at: new Date().toISOString(),
      })),
      { onConflict: "spot_id,item_name" },
    );
    setSaving(false);
    if (error) {
      toast.error(error.message);
      return;
    }
    setEditing(false);
    await load();
    toast.success("Counts updated.");
  };

  if (loading) {
    return (
      <div className="h-24 animate-pulse rounded-2xl bg-border/40" aria-label="Loading same-day stock" />
    );
  }

  if (spots.length === 0) {
    return (
      <div className="rounded-2xl border border-dashed border-border p-4">
        <p className="text-sm font-semibold">No same-day stock set for this drop</p>
        <p className="mt-1 text-xs text-ink-muted">
          Edit the listing, turn on "Sell at the table on the day", and enter how many of each item
          you are carrying to each same-day spot.
        </p>
      </div>
    );
  }

  return (
    <div className="rounded-2xl border border-border bg-surface-raised p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="flex items-center gap-1.5 text-base font-bold">
          <Store className="size-4 text-primary-dark" aria-hidden="true" />
          At the table today
        </h3>
        {spots.length > 1 && (
          <Select
            value={spotId}
            onChange={(e) => {
              setSpotId(e.target.value);
              setCart({});
              setEditing(false);
            }}
            aria-label="Pickup spot"
            className="h-9 w-auto min-w-44 text-sm"
          >
            {spots.map((spot) => (
              <option key={spot.id} value={spot.id}>
                {spot.name}
              </option>
            ))}
          </Select>
        )}
      </div>

      <dl className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-4">
        <Stat label="Brought here" value={String(spotTotals.brought)} />
        <Stat label="Sold here" value={String(spotTotals.sold)} />
        <Stat
          label="Left here"
          value={String(spotTotals.left)}
          tone={spotTotals.left === 0 && spotTotals.brought > 0 ? "accent" : undefined}
        />
        <Stat label="Taken here" value={formatPrice(spotTotals.collected)} />
      </dl>
      {spots.length > 1 && (
        <p className="mt-2 text-xs text-ink-muted">
          Across all {spots.length} spots: {allTotals.sold} of {allTotals.brought} sold,{" "}
          {allTotals.left} left, {formatPrice(allTotals.collected)} taken.
        </p>
      )}

      <ul className="mt-3 space-y-2">
        {here.map((row) => (
          <li
            key={row.item_name}
            className={cn(
              "flex flex-wrap items-center gap-2 rounded-xl border border-border/70 p-2.5",
              row.remaining === 0 && "opacity-60",
            )}
          >
            <span className="min-w-0 flex-1">
              <span className="block truncate text-sm font-semibold">{row.item_name}</span>
              <span className="block text-xs text-ink-muted">
                {row.remaining} left of {row.quantity}
                {row.sold > 0
                  ? ` · ${row.sold} sold · ${formatPrice(row.sold * priceOf(row.item_name))}`
                  : ""}
              </span>
            </span>
            {editing ? (
              <Input
                value={counts[row.item_name] ?? String(row.quantity)}
                onChange={(e) =>
                  setCounts((previous) => ({
                    ...previous,
                    [row.item_name]: e.target.value.replace(/[^\d]/g, ""),
                  }))
                }
                inputMode="numeric"
                aria-label={`Units of ${row.item_name} at this spot`}
                className="h-9 w-20 font-mono text-sm"
              />
            ) : (
              <span className="flex items-center gap-1.5">
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  className="size-9 px-0"
                  aria-label={`One fewer ${row.item_name}`}
                  disabled={!cart[row.item_name]}
                  onClick={() => bump(row.item_name, -1, row.remaining)}
                >
                  <Minus className="size-4" aria-hidden="true" />
                </Button>
                <span className="w-6 text-center font-mono text-sm font-bold">
                  {cart[row.item_name] ?? 0}
                </span>
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  className="size-9 px-0"
                  aria-label={`One more ${row.item_name}`}
                  disabled={(cart[row.item_name] ?? 0) >= row.remaining}
                  onClick={() => bump(row.item_name, 1, row.remaining)}
                >
                  <Plus className="size-4" aria-hidden="true" />
                </Button>
              </span>
            )}
          </li>
        ))}
      </ul>

      {editing ? (
        <div className="mt-3 flex flex-wrap gap-2">
          <Button type="button" size="sm" loading={saving} onClick={() => void saveCounts()}>
            <Check className="size-4" aria-hidden="true" />
            Save counts
          </Button>
          <Button type="button" size="sm" variant="ghost" onClick={() => setEditing(false)}>
            Cancel
          </Button>
        </div>
      ) : (
        <>
          {cartCount > 0 && (
            <div className="mt-3 rounded-xl border border-primary-dark/40 bg-primary/10 p-3">
              <p className="text-sm font-bold">
                {cartCount} {cartCount === 1 ? "item" : "items"} · {formatPrice(cartTotal)}
              </p>
              <div className="mt-2 grid gap-2 sm:grid-cols-2">
                <div>
                  <Label htmlFor="walkup-name" className="mb-1 text-xs">
                    Buyer name (optional)
                  </Label>
                  <Input
                    id="walkup-name"
                    value={buyerName}
                    onChange={(e) => setBuyerName(e.target.value)}
                    placeholder="Leave blank for an anonymous sale"
                    className="h-9 text-sm"
                  />
                </div>
                <div>
                  <Label htmlFor="walkup-email" className="mb-1 text-xs">
                    Buyer email (optional)
                  </Label>
                  <Input
                    id="walkup-email"
                    type="email"
                    value={buyerEmail}
                    onChange={(e) => setBuyerEmail(e.target.value)}
                    placeholder="For a receipt"
                    className="h-9 text-sm"
                  />
                </div>
              </div>
              <div className="mt-2 flex flex-wrap items-end gap-2">
                <div>
                  <Label htmlFor="walkup-pay" className="mb-1 text-xs">
                    Paid by
                  </Label>
                  <Select
                    id="walkup-pay"
                    value={payment}
                    onChange={(e) => setPayment(e.target.value)}
                    className="h-9 w-auto min-w-32 text-sm"
                  >
                    <option value="cash">Cash</option>
                    <option value="venmo">Venmo</option>
                    <option value="zelle">Zelle</option>
                  </Select>
                </div>
                <Button type="button" size="sm" loading={saving} onClick={() => void sell()}>
                  Record sale
                </Button>
                <Button type="button" size="sm" variant="ghost" onClick={() => setCart({})}>
                  Clear
                </Button>
              </div>
            </div>
          )}
          <div className="mt-3">
            <Button
              type="button"
              size="sm"
              variant="secondary"
              onClick={() => {
                setCounts(
                  Object.fromEntries(here.map((row) => [row.item_name, String(row.quantity)])),
                );
                setEditing(true);
              }}
            >
              Change what you brought
            </Button>
          </div>
        </>
      )}
    </div>
  );
}

function Stat({
  label,
  value,
  tone,
}: {
  label: string;
  value: string;
  tone?: "accent";
}) {
  return (
    <div className="min-w-0 rounded-xl border border-border/70 px-3 py-2">
      <dt className="truncate text-[11px] font-semibold uppercase tracking-wide text-ink-muted">
        {label}
      </dt>
      <dd
        className={cn(
          "mt-0.5 font-mono text-base font-extrabold tabular-nums",
          tone === "accent" && "text-accent",
        )}
      >
        {value}
      </dd>
    </div>
  );
}
