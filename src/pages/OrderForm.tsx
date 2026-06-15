import { useEffect, useMemo, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import { AlertTriangle, ArrowLeft, CheckCircle2, Minus, Plus, SearchX } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/lib/supabase";
import { useListing } from "@/hooks/useListings";
import { useAuth } from "@/hooks/useAuth";
import { useProfile } from "@/hooks/useProfile";
import { getSavedEmail, setSavedEmail } from "@/lib/local";
import { formatPrice } from "@/lib/format";
import { isValidNetid } from "@/lib/orders";
import { AllergenIcon } from "@/components/AllergenIcon";
import { SplitOrderToggle } from "@/components/SplitOrderToggle";
import { SplitTypeSelector, validSplitSizes } from "@/components/SplitTypeSelector";
import { GroupInviteLink } from "@/components/GroupInviteLink";
import { GoogleButton } from "@/components/GoogleButton";
import { EmptyState } from "@/components/EmptyState";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";
import type { PaymentMethod } from "@/types/database";

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

const PAYMENT_OPTIONS: { id: PaymentMethod; label: string }[] = [
  { id: "venmo", label: "Venmo" },
  { id: "zelle", label: "Zelle" },
  { id: "both", label: "Both" },
];

function FieldError({ message }: { message?: string }) {
  if (!message) return null;
  return (
    <p className="mt-1.5 text-xs font-medium text-accent" role="alert">
      {message}
    </p>
  );
}

export default function OrderForm() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const reduceMotion = useReducedMotion();
  const { listing, loading, error, refetch } = useListing(id);
  const { user, isGoogleUser } = useAuth();
  const { profile, loading: profileLoading } = useProfile();

  const [name, setName] = useState("");
  const [email, setEmail] = useState(getSavedEmail);
  const [netid, setNetid] = useState("");
  const [quantities, setQuantities] = useState<Record<string, number>>({});
  const [proxyEnabled, setProxyEnabled] = useState(false);
  const [proxyName, setProxyName] = useState("");
  const [proxyEmail, setProxyEmail] = useState("");
  const [proxyNetid, setProxyNetid] = useState("");
  const [payMethod, setPayMethod] = useState<PaymentMethod | null>(null);
  const [venmo, setVenmo] = useState("");
  const [zelle, setZelle] = useState("");
  // Optional "which member recommended you?" (Tranche 4 #2); blank = unset.
  const [recommender, setRecommender] = useState("");
  const [showErrors, setShowErrors] = useState(false);
  const [reviewOpen, setReviewOpen] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [placedId, setPlacedId] = useState<string | null>(null);

  // Split order mode (group orders).
  const [splitMode, setSplitMode] = useState(false);
  const [splitItemName, setSplitItemName] = useState<string | null>(null);
  const [splitType, setSplitType] = useState(2);
  const [splitEmails, setSplitEmails] = useState("");
  const [creatingGroup, setCreatingGroup] = useState(false);
  const [createdGroup, setCreatedGroup] = useState<{ groupId: string; token: string } | null>(null);
  // Private (invite-only) vs public (anyone fills open spots) — Tranche 4 #6.
  const [groupVisibility, setGroupVisibility] = useState<"private" | "public">("private");
  const [joiningPublic, setJoiningPublic] = useState(false);

  // Pre-fill from the signed-in profile; those fields render read-only.
  useEffect(() => {
    if (!profile) return;
    const fullName = `${profile.first_name} ${profile.last_name}`.trim();
    if (fullName) setName(fullName);
    if (profile.cornell_email) setEmail(profile.cornell_email);
    if (profile.cornell_netid) setNetid(profile.cornell_netid);
    if (profile.venmo_id) setVenmo(profile.venmo_id);
    if (profile.zelle_id) setZelle(profile.zelle_id);
  }, [profile]);

  // Lock body scroll while the review modal is open.
  useEffect(() => {
    if (!reviewOpen) return;
    const original = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = original;
    };
  }, [reviewOpen]);

  const items = listing?.items ?? [];

  const lines = useMemo(
    () =>
      items
        .map((item) => ({ item, qty: quantities[item.name] ?? 0 }))
        .filter((line) => line.qty > 0),
    [items, quantities],
  );
  const total = lines.reduce((sum, line) => sum + line.item.price * line.qty, 0);

  const nameLocked = Boolean(user && profile && `${profile.first_name}${profile.last_name}`.trim());
  const emailLocked = Boolean(user && profile?.cornell_email);
  const netidLocked = Boolean(user && profile?.cornell_netid);

  const errors = {
    name: name.trim().length >= 2 ? undefined : "Enter your name.",
    email: EMAIL_PATTERN.test(email.trim()) ? undefined : "Enter a valid email address.",
    netid: isValidNetid(netid) ? undefined : "Enter your NetID, like abc123.",
    items: lines.length > 0 ? undefined : "Pick at least one item.",
    proxyName: !proxyEnabled || proxyName.trim().length >= 2 ? undefined : "Enter your proxy's name.",
    proxyEmail:
      !proxyEnabled || EMAIL_PATTERN.test(proxyEmail.trim())
        ? undefined
        : "Enter a valid email for your proxy.",
    payMethod: payMethod ? undefined : "Pick how you are paying.",
    venmo:
      payMethod === "venmo" || payMethod === "both"
        ? venmo.trim()
          ? undefined
          : "Enter your Venmo username."
        : undefined,
    zelle:
      payMethod === "zelle" || payMethod === "both"
        ? zelle.trim()
          ? undefined
          : "Enter your Zelle email or phone."
        : undefined,
  };
  const hasErrors = Object.values(errors).some(Boolean);

  const setQty = (itemName: string, next: number) => {
    setQuantities((previous) => ({ ...previous, [itemName]: Math.max(0, Math.min(50, next)) }));
  };

  const openReview = () => {
    setShowErrors(true);
    if (hasErrors) {
      toast.error("Check the highlighted fields.");
      return;
    }
    setReviewOpen(true);
  };

  const confirm = async () => {
    if (!listing) return;
    setSubmitting(true);
    const { data, error: rpcError } = await supabase.rpc("create_order", {
      p_listing_id: listing.id,
      p_name: name.trim(),
      p_email: email.trim().toLowerCase(),
      p_netid: netid.trim().toLowerCase(),
      p_items: lines.map((line) => ({ name: line.item.name, qty: line.qty })),
      p_payment_method: payMethod!,
      p_venmo: payMethod === "venmo" || payMethod === "both" ? venmo.trim() : null,
      p_zelle: payMethod === "zelle" || payMethod === "both" ? zelle.trim() : null,
      p_proxy_name: proxyEnabled ? proxyName.trim() : null,
      p_proxy_email: proxyEnabled ? proxyEmail.trim().toLowerCase() : null,
      p_proxy_netid: proxyEnabled ? proxyNetid.trim().toLowerCase() || null : null,
    });
    if (rpcError) {
      setSubmitting(false);
      toast.error(rpcError.message);
      return;
    }
    // Best-effort: attach the recommender to the just-created order (#2).
    if (recommender) {
      const { error: recError } = await supabase.rpc("set_order_recommender", {
        p_order_id: data as string,
        p_value: recommender,
      });
      if (recError) console.warn("recommender not saved:", recError.message);
    }
    setSubmitting(false);
    setSavedEmail(email);
    setReviewOpen(false);
    setPlacedId(data as string);
  };

  if (loading || (user && profileLoading)) {
    return (
      <div className="mx-auto w-full max-w-xl px-4 py-8" aria-busy="true" aria-label="Loading order form">
        <div className="h-9 w-40 animate-pulse rounded-xl bg-border/60" />
        <div className="mt-6 space-y-4">
          {Array.from({ length: 5 }, (_, index) => (
            <div key={index} className="h-16 animate-pulse rounded-2xl bg-border/40" />
          ))}
        </div>
      </div>
    );
  }

  if (error || !listing) {
    return (
      <div className="mx-auto w-full max-w-xl px-4 py-12">
        <EmptyState
          icon={error ? <AlertTriangle className="size-6" aria-hidden="true" /> : <SearchX className="size-6" aria-hidden="true" />}
          title={error ? "Could not load this listing" : "Listing not found"}
          body={error ? "Give it another try." : "This drop may have been taken down."}
          actionLabel={error ? "Retry" : "Back to feed"}
          onAction={() => (error ? void refetch() : navigate("/"))}
        />
      </div>
    );
  }

  if (!listing.active || new Date(listing.expires_at).getTime() <= Date.now()) {
    return (
      <div className="mx-auto w-full max-w-xl px-4 py-12">
        <EmptyState
          icon={<SearchX className="size-6" aria-hidden="true" />}
          title="This drop is not taking orders"
          body="It has ended or been deactivated by the club. The feed has what is live right now."
          actionLabel="Back to feed"
          onAction={() => navigate("/")}
        />
      </div>
    );
  }

  // Ordering requires a Google account: every order ties to a real identity so
  // clubs can match payments and passes cannot be placed anonymously.
  if (!user || !isGoogleUser) {
    return (
      <div className="mx-auto w-full max-w-md px-4 py-12">
        <Button
          variant="ghost"
          size="sm"
          onClick={() => navigate(`/listing/${listing.id}`)}
          className="-ml-2 text-ink-muted"
        >
          <ArrowLeft className="size-4" aria-hidden="true" />
          {listing.title}
        </Button>
        <div className="mt-4 rounded-2xl border border-border bg-surface-raised p-6 text-center">
          <h1 className="text-xl font-extrabold tracking-tight">Sign in to order</h1>
          <p className="mt-2 text-sm text-ink-muted">
            Ordering from {listing.clubs?.name ?? "a Cornell club"} takes a Google account so
            the club can match your payment and send your QR pickup pass.
          </p>
          <div className="mt-5">
            <GoogleButton label="Sign in to order" redirectPath={`/listing/${listing.id}/order-form`} />
          </div>
        </div>
      </div>
    );
  }

  const splitItem = items.find((item) => item.name === splitItemName) ?? null;
  const groupsEnabled = listing.clubs?.groups_enabled ?? true;
  const splitItemQty = Math.max(1, splitItem?.quantity ?? 1);
  const splitUnitsPerPerson = splitType > 0 ? Math.floor(splitItemQty / splitType) : 0;
  // Selecting an item snaps the split size to its smallest valid divisor.
  const selectSplitItem = (name: string, quantity: number) => {
    setSplitItemName(name);
    const sizes = validSplitSizes(quantity);
    setSplitType(sizes[0] ?? 2);
  };

  const createGroup = async () => {
    if (!listing || !splitItem) {
      toast.error("Pick the item to split.");
      return;
    }
    setCreatingGroup(true);
    const emails = splitEmails
      .split(/[,\n;]+/)
      .map((entry) => entry.trim().toLowerCase())
      .filter((entry) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(entry));
    const { data, error: rpcError } = await supabase.rpc("create_order_group", {
      p_listing_id: listing.id,
      p_item_name: splitItem.name,
      p_split_type: splitType,
      p_invited_emails: emails,
      p_visibility: groupVisibility,
    });
    setCreatingGroup(false);
    if (rpcError) {
      toast.error(rpcError.message);
      return;
    }
    const result = data as unknown as { group_id: string; open_token: string | null };
    if (result.open_token) {
      setCreatedGroup({ groupId: result.group_id, token: result.open_token });
    } else {
      // Private group: no open link, members invite by email from My orders.
      navigate("/orders");
    }
    toast.success(groupVisibility === "public" ? "Public group started" : "Private group started");
  };

  // Solo path: auto-join the earliest open public group for this item + size.
  const joinPublic = async () => {
    if (!listing || !splitItem) {
      toast.error("Pick the item to split.");
      return;
    }
    setJoiningPublic(true);
    const { data, error: rpcError } = await supabase.rpc("join_or_create_public_group", {
      p_listing_id: listing.id,
      p_item: splitItem.name,
      p_total_people: splitType,
    });
    setJoiningPublic(false);
    if (rpcError) {
      toast.error(rpcError.message);
      return;
    }
    const result = data as unknown as { group_id: string; open_token?: string | null; joined: boolean };
    if (result.joined) {
      toast.success("You joined an open group. Track it in My orders.");
      navigate("/orders");
    } else if (result.open_token) {
      setCreatedGroup({ groupId: result.group_id, token: result.open_token });
      toast.success("No open group yet — started one others can join.");
    } else {
      navigate("/orders");
    }
  };

  if (createdGroup) {
    return (
      <div className="mx-auto w-full max-w-md px-4 py-16">
        <motion.div
          initial={reduceMotion ? false : { opacity: 0, scale: 0.95 }}
          animate={{ opacity: 1, scale: 1 }}
          transition={{ duration: 0.15, ease: [0.16, 1, 0.3, 1] }}
          className="rounded-2xl border border-border bg-surface-raised p-8"
        >
          <div className="mx-auto flex size-14 items-center justify-center rounded-2xl bg-tag-green">
            <CheckCircle2 className="size-7 text-ink" aria-hidden="true" />
          </div>
          <h1 className="mt-5 text-center text-2xl font-extrabold">Split order started</h1>
          <p className="mt-3 text-center text-sm text-ink-muted">
            Share this link. When {splitType} people are in, everyone gets 24 hours to pay
            their {splitItem ? formatPrice(splitItem.price / splitType) : "share"} and takes home{" "}
            {splitUnitsPerPerson} {splitUnitsPerPerson === 1 ? "unit" : "units"}.
          </p>
          <div className="mt-5">
            <GroupInviteLink token={createdGroup.token} />
          </div>
          <Button className="mt-5 w-full" onClick={() => navigate("/orders")}>
            Track my group
          </Button>
        </motion.div>
      </div>
    );
  }

  if (placedId) {
    return (
      <div className="mx-auto w-full max-w-md px-4 py-16">
        <motion.div
          initial={reduceMotion ? false : { opacity: 0, scale: 0.95 }}
          animate={{ opacity: 1, scale: 1 }}
          transition={{ duration: 0.15, ease: [0.16, 1, 0.3, 1] }}
          className="rounded-2xl border border-border bg-surface-raised p-8 text-center"
        >
          <div className="mx-auto flex size-14 items-center justify-center rounded-2xl bg-tag-green">
            <CheckCircle2 className="size-7 text-ink" aria-hidden="true" />
          </div>
          <h1 className="mt-5 text-2xl font-extrabold">Order placed</h1>
          <p className="mt-3 text-sm text-ink-muted">
            Now pay {listing.clubs?.name ?? "the club"} {formatPrice(total)} over{" "}
            {payMethod === "both" ? "Venmo or Zelle" : payMethod === "venmo" ? "Venmo" : "Zelle"}.
            Once they verify your payment, your QR pickup pass lands in {email.trim().toLowerCase()}.
          </p>
          <p className="mt-3 rounded-xl bg-surface px-3 py-2.5 text-xs text-ink-muted">
            📩 Passes can land in <span className="font-semibold text-ink">spam</span> — check there
            if you don't see it, and once it arrives mark it "Not spam" / add the sender to your
            contacts so future passes go straight to your inbox.
          </p>
          <Button className="mt-6 w-full" onClick={() => navigate(`/orders/${placedId}`)}>
            Track my order
          </Button>
          <Button variant="ghost" className="mt-2 w-full" onClick={() => navigate(`/listing/${listing.id}`)}>
            Back to the listing
          </Button>
        </motion.div>
      </div>
    );
  }

  return (
    <div className="mx-auto w-full max-w-xl px-4 py-8">
      <Button
        variant="ghost"
        size="sm"
        onClick={() => navigate(`/listing/${listing.id}`)}
        className="-ml-2 text-ink-muted"
      >
        <ArrowLeft className="size-4" aria-hidden="true" />
        {listing.title}
      </Button>
      <h1 className="mt-3 text-2xl font-extrabold tracking-tight">Place an order</h1>
      <p className="mt-1 text-sm text-ink-muted">
        {listing.brand}, sold by {listing.clubs?.name ?? "a Cornell club"}. Pay the club
        directly; your QR pickup pass arrives once they verify the payment.
      </p>

      <form
        noValidate
        onSubmit={(event) => {
          event.preventDefault();
          openReview();
        }}
        className="mt-8 space-y-6"
      >
        {/* 1-2. Who is ordering */}
        <section className="space-y-5">
          <div>
            <Label htmlFor="order-name">Name</Label>
            <Input
              id="order-name"
              value={name}
              readOnly={nameLocked}
              invalid={showErrors && Boolean(errors.name)}
              onChange={(e) => setName(e.target.value)}
              placeholder="Your name"
              autoComplete="name"
              className={cn(nameLocked && "bg-surface")}
            />
            {nameLocked && <p className="mt-1.5 text-xs text-ink-muted">From your account.</p>}
            <FieldError message={showErrors ? errors.name : undefined} />
          </div>
          <div className="grid gap-5 sm:grid-cols-2">
            <div>
              <Label htmlFor="order-netid">NetID</Label>
              <Input
                id="order-netid"
                value={netid}
                readOnly={netidLocked}
                invalid={showErrors && Boolean(errors.netid)}
                onChange={(e) => setNetid(e.target.value)}
                placeholder="abc123"
                className={cn(netidLocked && "bg-surface")}
              />
              <FieldError message={showErrors ? errors.netid : undefined} />
            </div>
            <div>
              <Label htmlFor="order-email">Cornell email</Label>
              <Input
                id="order-email"
                type="email"
                value={email}
                readOnly={emailLocked}
                invalid={showErrors && Boolean(errors.email)}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="netid@cornell.edu"
                autoComplete="email"
                className={cn(emailLocked && "bg-surface")}
              />
              <FieldError message={showErrors ? errors.email : undefined} />
            </div>
          </div>
        </section>

        {/* 3. Items */}
        <section className="rounded-2xl border border-border bg-surface-raised p-4">
          <h2 className="text-base font-bold">Items</h2>
          <ul className="mt-2 divide-y divide-border/60">
            {items.map((item) => {
              const qty = quantities[item.name] ?? 0;
              return (
                <li key={item.name} className="flex flex-wrap items-center justify-between gap-3 py-3">
                  <div className="min-w-0 flex-1">
                    <p className="flex items-center gap-1.5 text-sm font-semibold">
                      {(item.dietary_tags ?? []).map((tag) => (
                        <AllergenIcon key={tag} tag={tag} className="text-ink-muted" />
                      ))}
                      <span className="truncate">{item.name}</span>
                      {(item.quantity ?? 1) > 1 && (
                        <span className="shrink-0 text-xs font-normal text-ink-muted">
                          {"·"} {item.quantity} in a box
                        </span>
                      )}
                    </p>
                    <p className="font-mono text-xs text-ink-muted">{formatPrice(item.price)}</p>
                  </div>
                  <div className="flex items-center gap-2">
                    <Button
                      type="button"
                      variant="secondary"
                      size="sm"
                      aria-label={`Fewer ${item.name}`}
                      disabled={qty <= 0}
                      onClick={() => setQty(item.name, qty - 1)}
                      className="size-11 px-0"
                    >
                      <Minus className="size-4" aria-hidden="true" />
                    </Button>
                    <span className="w-7 text-center font-mono text-base font-bold" aria-live="polite">
                      {qty}
                    </span>
                    <Button
                      type="button"
                      variant="secondary"
                      size="sm"
                      aria-label={`More ${item.name}`}
                      onClick={() => setQty(item.name, qty + 1)}
                      className="size-11 px-0"
                    >
                      <Plus className="size-4" aria-hidden="true" />
                    </Button>
                    <span className="w-16 text-right font-mono text-sm font-semibold">
                      {qty > 0 ? formatPrice(item.price * qty) : ""}
                    </span>
                  </div>
                </li>
              );
            })}
          </ul>
          <FieldError message={showErrors ? errors.items : undefined} />
        </section>

        {/* Split order mode (hidden when the club has disabled group ordering) */}
        {groupsEnabled && (
        <>
        <SplitOrderToggle enabled={splitMode} onChange={setSplitMode} />

        {splitMode && (
          <section className="rounded-2xl border border-primary-dark/40 bg-primary/10 p-4">
            {!user || !isGoogleUser ? (
              <div>
                <p className="text-sm font-semibold">Sign in to start a split order</p>
                <p className="mt-1 text-xs text-ink-muted">
                  Group members each get their own QR pass, so everyone needs a Google
                  account.
                </p>
                <div className="mt-3">
                  <GoogleButton
                    label="Sign in and split"
                    redirectPath={`/listing/${listing.id}/order-form`}
                  />
                </div>
              </div>
            ) : (
              <div>
                <h2 className="text-base font-bold">What are you splitting?</h2>
                <p className="mt-1 text-xs text-ink-muted">
                  Only items that divide evenly can be split, so everyone gets whole units.
                </p>
                <div className="mt-3 flex flex-col gap-2" role="radiogroup" aria-label="Item to split">
                  {items.map((item) => {
                    const selected = splitItemName === item.name;
                    const qty = Math.max(1, item.quantity ?? 1);
                    const splittable = validSplitSizes(qty).length > 0;
                    return (
                      <button
                        key={item.name}
                        type="button"
                        role="radio"
                        aria-checked={selected}
                        disabled={!splittable}
                        onClick={() => selectSplitItem(item.name, qty)}
                        className={cn(
                          "flex min-h-11 items-center justify-between gap-3 rounded-xl border px-3.5 py-2.5 text-left transition-colors duration-150 [transition-timing-function:var(--ease-out)] active:scale-[0.98] disabled:pointer-events-none disabled:opacity-45",
                          selected
                            ? "border-primary-dark bg-surface-raised"
                            : "border-border bg-surface-raised/60 hover-fine:border-primary",
                        )}
                      >
                        <span className="flex min-w-0 items-center gap-1.5 text-sm font-semibold">
                          {(item.dietary_tags ?? []).map((tag) => (
                            <AllergenIcon key={tag} tag={tag} className="text-ink-muted" />
                          ))}
                          <span className="truncate">{item.name}</span>
                          {qty > 1 && (
                            <span className="shrink-0 text-xs font-normal text-ink-muted">
                              {"·"} {qty} in a box
                            </span>
                          )}
                        </span>
                        <span className="shrink-0 font-mono text-sm font-bold">
                          {splittable ? formatPrice(item.price) : "Can't split"}
                        </span>
                      </button>
                    );
                  })}
                </div>

                {splitItem && (
                  <div className="mt-4">
                    <Label>Split how many ways?</Label>
                    <SplitTypeSelector
                      itemPrice={splitItem.price}
                      itemQuantity={splitItemQty}
                      value={splitType}
                      onChange={setSplitType}
                    />
                    <p className="mt-1.5 text-xs text-ink-muted">
                      Each person pays {formatPrice(splitItem.price / splitType)} and takes home{" "}
                      {splitUnitsPerPerson} of {splitItemQty} units.
                    </p>
                  </div>
                )}

                <div className="mt-4">
                  <Label>Who can join?</Label>
                  <div className="mt-1.5 flex gap-2" role="radiogroup" aria-label="Group visibility">
                    {(["private", "public"] as const).map((option) => (
                      <button
                        key={option}
                        type="button"
                        role="radio"
                        aria-checked={groupVisibility === option}
                        onClick={() => setGroupVisibility(option)}
                        className={cn(
                          "flex-1 rounded-xl border px-3 py-2.5 text-left transition-colors duration-150 [transition-timing-function:var(--ease-out)] active:scale-[0.98]",
                          groupVisibility === option
                            ? "border-primary-dark bg-surface-raised"
                            : "border-border bg-surface-raised/60 hover-fine:border-primary",
                        )}
                      >
                        <span className="block text-sm font-bold capitalize">{option}</span>
                        <span className="block text-xs text-ink-muted">
                          {option === "private"
                            ? "Only people you invite can join."
                            : "Anyone can fill the open spots."}
                        </span>
                      </button>
                    ))}
                  </div>
                </div>

                <div className="mt-4">
                  <Label htmlFor="split-emails">Invite by email (optional)</Label>
                  <Input
                    id="split-emails"
                    value={splitEmails}
                    onChange={(e) => setSplitEmails(e.target.value)}
                    placeholder="friend1@cornell.edu, friend2@cornell.edu"
                  />
                  <p className="mt-1.5 text-xs text-ink-muted">
                    {groupVisibility === "private"
                      ? "They get an email with a join link. Group members can invite more from My orders."
                      : "Optional head start. Anyone can also fill open spots, and you get a shareable link."}
                  </p>
                </div>

                <Button
                  type="button"
                  className="mt-5 w-full"
                  size="lg"
                  loading={creatingGroup}
                  disabled={!splitItem || joiningPublic}
                  onClick={() => void createGroup()}
                >
                  {groupVisibility === "public" ? "Start a public group" : "Start a private group"}
                </Button>

                {groupVisibility === "public" && (
                  <>
                    <div className="my-3 flex items-center gap-3 text-xs text-ink-muted">
                      <span className="h-px flex-1 bg-border" />
                      or
                      <span className="h-px flex-1 bg-border" />
                    </div>
                    <Button
                      type="button"
                      variant="secondary"
                      className="w-full"
                      size="lg"
                      loading={joiningPublic}
                      disabled={!splitItem || creatingGroup}
                      onClick={() => void joinPublic()}
                    >
                      Join an open group (I'm solo)
                    </Button>
                    <p className="mt-1.5 text-center text-xs text-ink-muted">
                      We add you to the earliest open group for this item and split size, or start one.
                    </p>
                  </>
                )}
              </div>
            )}
          </section>
        )}
        </>
        )}

        {!splitMode && (
        <>
        {/* 4. Proxy pickup */}
        <section className="rounded-2xl border border-border bg-surface-raised p-4">
          <label className="flex min-h-11 cursor-pointer items-center justify-between gap-3">
            <span>
              <span className="block text-sm font-bold">Someone else may pick this up</span>
              <span className="block text-xs text-ink-muted">
                They get their own QR pass by email. You can disable it anytime.
              </span>
            </span>
            <input
              type="checkbox"
              checked={proxyEnabled}
              onChange={(e) => setProxyEnabled(e.target.checked)}
              className="size-5 shrink-0 accent-(--color-primary-dark)"
            />
          </label>
          <AnimatePresence initial={false}>
            {proxyEnabled && (
              <motion.div
                initial={reduceMotion ? false : { opacity: 0, height: 0 }}
                animate={{ opacity: 1, height: "auto" }}
                exit={{ opacity: 0, height: 0, transition: { duration: 0.12 } }}
                transition={{ duration: 0.2, ease: [0.23, 1, 0.32, 1] }}
                className="overflow-hidden"
              >
                <div className="mt-4 space-y-4">
                  <div>
                    <Label htmlFor="proxy-name">Proxy name</Label>
                    <Input
                      id="proxy-name"
                      value={proxyName}
                      invalid={showErrors && Boolean(errors.proxyName)}
                      onChange={(e) => setProxyName(e.target.value)}
                      placeholder="Their name"
                    />
                    <FieldError message={showErrors ? errors.proxyName : undefined} />
                  </div>
                  <div className="grid gap-4 sm:grid-cols-2">
                    <div>
                      <Label htmlFor="proxy-email">Proxy email</Label>
                      <Input
                        id="proxy-email"
                        type="email"
                        value={proxyEmail}
                        invalid={showErrors && Boolean(errors.proxyEmail)}
                        onChange={(e) => setProxyEmail(e.target.value)}
                        placeholder="their-netid@cornell.edu"
                      />
                      <FieldError message={showErrors ? errors.proxyEmail : undefined} />
                    </div>
                    <div>
                      <Label htmlFor="proxy-netid">Proxy NetID (optional)</Label>
                      <Input
                        id="proxy-netid"
                        value={proxyNetid}
                        onChange={(e) => setProxyNetid(e.target.value)}
                        placeholder="ab123"
                      />
                    </div>
                  </div>
                </div>
              </motion.div>
            )}
          </AnimatePresence>
        </section>

        {/* Recommender (optional) */}
        {listing.recommender_enabled && (listing.clubs?.member_options?.length ?? 0) > 0 && (
          <section className="rounded-2xl border border-border bg-surface-raised p-4">
            <Label htmlFor="order-recommender">Which member recommended you? (optional)</Label>
            <select
              id="order-recommender"
              value={recommender}
              onChange={(e) => setRecommender(e.target.value)}
              className="mt-1.5 h-11 w-full rounded-xl border border-border bg-surface-raised px-3 text-base text-ink focus-visible:border-primary-dark focus-visible:outline-2 focus-visible:outline-offset-0 focus-visible:outline-primary/40"
            >
              <option value="">No one in particular</option>
              {listing.clubs!.member_options.map((member) => (
                <option key={member} value={member}>
                  {member}
                </option>
              ))}
            </select>
            <p className="mt-1.5 text-xs text-ink-muted">
              Helps {listing.clubs?.name ?? "the club"} credit the member who sent you.
            </p>
          </section>
        )}

        {/* 5-6. Payment */}
        <section className="rounded-2xl border border-border bg-surface-raised p-4">
          <h2 className="text-base font-bold">How are you paying?</h2>
          <p className="mt-1 text-xs text-ink-muted">
            The club matches your payment to these details before sending your QR pass.
          </p>
          <div className="mt-3 flex flex-wrap gap-2" role="radiogroup" aria-label="Payment method">
            {PAYMENT_OPTIONS.map(({ id: optionId, label }) => (
              <button
                key={optionId}
                type="button"
                role="radio"
                aria-checked={payMethod === optionId}
                onClick={() => setPayMethod(optionId)}
                className={cn(
                  "min-h-11 rounded-full border px-4 py-2 text-sm font-semibold transition-colors duration-150 [transition-timing-function:var(--ease-out)] active:scale-[0.97]",
                  payMethod === optionId
                    ? "border-ink bg-ink text-surface-raised"
                    : "border-border bg-surface-raised text-ink hover-fine:border-primary",
                )}
              >
                {label}
              </button>
            ))}
          </div>
          <FieldError message={showErrors ? errors.payMethod : undefined} />

          {(payMethod === "venmo" || payMethod === "both") && (
            <div className="mt-4">
              <Label htmlFor="order-venmo">Your Venmo username</Label>
              <Input
                id="order-venmo"
                value={venmo}
                invalid={showErrors && Boolean(errors.venmo)}
                onChange={(e) => setVenmo(e.target.value)}
                placeholder="@your-venmo"
              />
              <FieldError message={showErrors ? errors.venmo : undefined} />
            </div>
          )}
          {(payMethod === "zelle" || payMethod === "both") && (
            <div className="mt-4">
              <Label htmlFor="order-zelle">Your Zelle email or phone</Label>
              <Input
                id="order-zelle"
                value={zelle}
                invalid={showErrors && Boolean(errors.zelle)}
                onChange={(e) => setZelle(e.target.value)}
                placeholder="netid@cornell.edu"
              />
              <FieldError message={showErrors ? errors.zelle : undefined} />
            </div>
          )}
        </section>

        {/* 7. Sticky total + submit (sits above the mobile tab bar) */}
        <div className="sticky bottom-16 z-raised -mx-4 border-t border-border bg-surface/95 px-4 py-3 backdrop-blur-md md:static md:mx-0 md:rounded-2xl md:border md:bg-surface-raised md:p-4">
          <div className="flex items-center justify-between gap-3">
            <div>
              <p className="text-xs font-semibold uppercase tracking-wide text-ink-muted">Total</p>
              <p className="font-mono text-xl font-bold" aria-live="polite">
                {formatPrice(total)}
              </p>
            </div>
            <Button type="submit" size="lg">
              Review order
            </Button>
          </div>
        </div>
        </>
        )}
      </form>

      {/* Review modal */}
      <AnimatePresence>
        {reviewOpen && (
          <>
            <motion.button
              type="button"
              aria-label="Close review"
              className="z-overlay fixed inset-0 bg-ink/45"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1, transition: { duration: 0.2 } }}
              exit={{ opacity: 0, transition: { duration: 0.15 } }}
              onClick={() => setReviewOpen(false)}
            />
            <div className="z-modal pointer-events-none fixed inset-0 flex items-end justify-center p-4 sm:items-center">
              <motion.div
                role="dialog"
                aria-modal="true"
                aria-label="Review your order"
                className="pointer-events-auto max-h-[85dvh] w-full max-w-md overflow-y-auto rounded-2xl border border-border bg-surface-raised p-5 shadow-[0_12px_40px_oklch(18%_0.02_260/0.25)]"
                initial={reduceMotion ? { opacity: 0 } : { opacity: 0, scale: 0.95 }}
                animate={{ opacity: 1, scale: 1 }}
                exit={{ opacity: 0, scale: 0.95, transition: { duration: 0.1 } }}
                transition={{ duration: 0.15, ease: [0.16, 1, 0.3, 1] }}
              >
                <h2 className="text-lg font-bold">Review your order</h2>

                <dl className="mt-4 space-y-3 text-sm">
                  <div>
                    <dt className="text-xs font-semibold uppercase tracking-wide text-ink-muted">Orderer</dt>
                    <dd className="mt-0.5">
                      {name.trim()}, {netid.trim().toLowerCase()}, {email.trim().toLowerCase()}
                    </dd>
                  </div>
                  <div>
                    <dt className="text-xs font-semibold uppercase tracking-wide text-ink-muted">Items</dt>
                    <dd className="mt-0.5">
                      <ul className="divide-y divide-border/60">
                        {lines.map(({ item, qty }) => (
                          <li key={item.name} className="flex justify-between gap-3 py-1.5">
                            <span>
                              {qty}x {item.name}
                            </span>
                            <span className="font-mono">{formatPrice(item.price * qty)}</span>
                          </li>
                        ))}
                        <li className="flex justify-between gap-3 py-1.5 font-bold">
                          <span>Total</span>
                          <span className="font-mono">{formatPrice(total)}</span>
                        </li>
                      </ul>
                    </dd>
                  </div>
                  {proxyEnabled && (
                    <div>
                      <dt className="text-xs font-semibold uppercase tracking-wide text-ink-muted">Proxy pickup</dt>
                      <dd className="mt-0.5">
                        {proxyName.trim()}, {proxyEmail.trim().toLowerCase()}
                      </dd>
                    </div>
                  )}
                  <div>
                    <dt className="text-xs font-semibold uppercase tracking-wide text-ink-muted">Payment</dt>
                    <dd className="mt-0.5">
                      {payMethod === "both" ? "Venmo or Zelle" : payMethod === "venmo" ? "Venmo" : "Zelle"}
                      {(payMethod === "venmo" || payMethod === "both") && (
                        <span className="ml-1 font-mono text-xs">@{venmo.trim().replace(/^@/, "")}</span>
                      )}
                      {(payMethod === "zelle" || payMethod === "both") && (
                        <span className="ml-1 font-mono text-xs">{zelle.trim()}</span>
                      )}
                    </dd>
                  </div>
                </dl>

                <p className="mt-4 rounded-xl bg-primary/15 p-3 text-xs text-ink">
                  Pay the club, then wait for them to verify it. Your QR pickup pass is
                  emailed only after verification.
                </p>
                <p className="mt-2 text-xs text-ink-muted">
                  You pay {listing.clubs?.name ?? "the club"} directly over{" "}
                  {payMethod === "both" ? "Venmo or Zelle" : payMethod === "venmo" ? "Venmo" : "Zelle"}.
                  Cornell Craves does not process payments. By confirming you agree to the{" "}
                  <a
                    href="/terms"
                    target="_blank"
                    rel="noreferrer"
                    className="font-semibold text-primary-dark underline-offset-2 hover-fine:underline"
                  >
                    terms
                  </a>
                  .
                </p>

                <div className="mt-5 flex justify-end gap-2">
                  <Button variant="ghost" onClick={() => setReviewOpen(false)}>
                    Edit
                  </Button>
                  <Button loading={submitting} onClick={() => void confirm()}>
                    Confirm order
                  </Button>
                </div>
              </motion.div>
            </div>
          </>
        )}
      </AnimatePresence>
    </div>
  );
}
