// Cornell Craves notification function.
//
// Handles two kinds of requests:
//
// A. Database Webhooks (configure in the Supabase dashboard, see README):
//    1. INSERT on public.listings     -> emails craving subscribers whose brands
//       contain the new listing's brand (deduplicated via notifications_log).
//    2. UPDATE on public.clubs        -> approved false -> true sends the club
//       a welcome email.
//    3. INSERT on public.reservations -> sends the student a pickup
//       confirmation email.
//    4. INSERT on public.reviews      -> notifies the club a review landed.
//    5. INSERT on public.qa           -> notifies the club a question landed.
//
// B. Direct invocation from the app (supabase.functions.invoke):
//    { action: "send_reminders", slot_id } -> emails everyone reserved on the
//    slot. Caller must be signed in as the club that owns the slot's listing.
//
// Secrets (set with `supabase secrets set`):
//   BREVO_API_KEY   required (Brevo transactional email; https://app.brevo.com -> SMTP & API)
//   SITE_URL        optional, defaults to http://localhost:5173
//   FROM_EMAIL      required for real sending; must be a Brevo-verified sender,
//                   in the form "Cornell Craves <you@yourdomain.com>"

import { createClient } from "npm:@supabase/supabase-js@2";

interface ListingRecord {
  id: string;
  club_id: string;
  brand: string;
  title: string;
  description: string | null;
  pickup_info: string | null;
  expires_at: string;
  active: boolean;
}

interface ClubRecord {
  id: string;
  name: string;
  email: string;
  approved: boolean;
}

interface ReservationRecord {
  id: string;
  slot_id: string;
  user_email: string;
  user_name: string;
  quantity: number;
}

interface ReviewRecord {
  id: string;
  listing_id: string;
  reviewer_name: string;
  rating: number;
  title: string;
}

interface QARecord {
  id: string;
  listing_id: string;
  question: string;
}

interface WebhookPayload {
  type: "INSERT" | "UPDATE" | "DELETE";
  table: string;
  schema: string;
  record: Record<string, unknown> | null;
  old_record: Record<string, unknown> | null;
}

const supabase = createClient(
  Deno.env.get("SUPABASE_URL")!,
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
);

const BREVO_API_KEY = Deno.env.get("BREVO_API_KEY") ?? "";
const SITE_URL = (Deno.env.get("SITE_URL") ?? "http://localhost:5173").replace(/\/+$/, "");
const FROM_EMAIL = Deno.env.get("FROM_EMAIL") ?? "Cornell Craves <no-reply@example.com>";
const QR_SECRET = Deno.env.get("QR_SECRET") ?? "";

function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// Parse a "Name <email@domain>" string (or a plain address) into Brevo's
// sender shape. Brevo wants name and email as separate fields.
function parseSender(value: string): { name: string; email: string } {
  const match = value.match(/^\s*(.*?)\s*<([^>]+)>\s*$/);
  if (match) {
    return { name: match[1] || "Cornell Craves", email: match[2].trim() };
  }
  return { name: "Cornell Craves", email: value.trim() };
}

async function sendEmail(to: string, subject: string, html: string): Promise<void> {
  const response = await fetch("https://api.brevo.com/v3/smtp/email", {
    method: "POST",
    headers: {
      "api-key": BREVO_API_KEY,
      "Content-Type": "application/json",
      accept: "application/json",
    },
    body: JSON.stringify({
      sender: parseSender(FROM_EMAIL),
      to: [{ email: to }],
      subject,
      htmlContent: html,
    }),
  });
  if (!response.ok) {
    throw new Error(`Brevo responded ${response.status}: ${await response.text()}`);
  }
}

function emailShell(heading: string, bodyHtml: string, ctaLabel: string, ctaHref: string): string {
  return `
    <div style="font-family:system-ui,-apple-system,'Segoe UI',sans-serif;max-width:480px;margin:0 auto;padding:24px;">
      <p style="margin:0 0 8px;font-size:13px;font-weight:700;letter-spacing:0.04em;color:#b8761f;">CORNELL CRAVES</p>
      <h1 style="margin:0 0 12px;font-size:22px;color:#16181f;">${heading}</h1>
      ${bodyHtml}
      <a href="${ctaHref}" style="display:inline-block;background:#f1ad3d;color:#16181f;font-weight:700;padding:12px 20px;border-radius:12px;text-decoration:none;">${ctaLabel}</a>
      <p style="margin:24px 0 0;font-size:12px;color:#888;">Sent by Cornell Craves, the campus food fundraiser feed.</p>
    </div>
  `;
}

function paragraph(text: string): string {
  return `<p style="margin:0 0 16px;color:#444;">${text}</p>`;
}

function formatSlotWindow(startIso: string, endIso: string): string {
  const options: Intl.DateTimeFormatOptions = {
    weekday: "short",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
    timeZone: "America/New_York",
  };
  const start = new Date(startIso).toLocaleString("en-US", options);
  const end = new Date(endIso).toLocaleTimeString("en-US", {
    hour: "numeric",
    minute: "2-digit",
    timeZone: "America/New_York",
  });
  return `${start} to ${end} (Ithaca time)`;
}

// ---------- QR pass tokens (HMAC-SHA256 via WebCrypto) ----------

interface OrderRecord {
  id: string;
  listing_id: string;
  orderer_name: string;
  orderer_email: string;
  items_json: { name: string; price: number; qty: number }[];
  total: number;
  payment_method: string;
  payment_verified: boolean;
  status: string;
  proxy_name: string | null;
  proxy_email: string | null;
}

const textEncoder = new TextEncoder();

function b64urlEncode(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/, "");
}

function b64urlDecode(value: string): Uint8Array {
  const padded = value.replaceAll("-", "+").replaceAll("_", "/").padEnd(Math.ceil(value.length / 4) * 4, "=");
  const binary = atob(padded);
  return Uint8Array.from(binary, (char) => char.charCodeAt(0));
}

async function hmacKey(): Promise<CryptoKey> {
  if (!QR_SECRET) throw new Error("QR_SECRET is not set");
  return crypto.subtle.importKey(
    "raw",
    textEncoder.encode(QR_SECRET),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign", "verify"],
  );
}

// Token payloads: solo orders use { o: order_id, t: "orderer" | "proxy", ts },
// group passes use { g: group_id, m: member_id, ts }.
type TokenPayload = Record<string, string | number>;

async function signToken(payload: TokenPayload): Promise<string> {
  const body = b64urlEncode(textEncoder.encode(JSON.stringify(payload)));
  const signature = new Uint8Array(
    await crypto.subtle.sign("HMAC", await hmacKey(), textEncoder.encode(body)),
  );
  return `${body}.${b64urlEncode(signature)}`;
}

async function verifyToken(token: string): Promise<TokenPayload | null> {
  const [body, signature] = token.split(".");
  if (!body || !signature) return null;
  try {
    const valid = await crypto.subtle.verify(
      "HMAC",
      await hmacKey(),
      b64urlDecode(signature),
      textEncoder.encode(body),
    );
    if (!valid) return null;
    return JSON.parse(new TextDecoder().decode(b64urlDecode(body)));
  } catch {
    return null;
  }
}

function qrImageUrl(token: string): string {
  return `https://api.qrserver.com/v1/create-qr-code/?size=240x240&data=${encodeURIComponent(token)}`;
}

// Many email clients block remote images by default, hiding the QR (build spec 5 #13).
const IMAGE_HINT =
  "Don't see the QR image? Your email app may be blocking images. Tap “Download images” or “Show images” to load it. If it still won't show, use the pickup code below.";

function itemsSummary(items: OrderRecord["items_json"]): string {
  return items.map((item) => `${item.qty}x ${item.name}`).join(", ");
}

function dollars(value: number): string {
  return `$${Number(value).toFixed(2)}`;
}

async function requireClubUser(authHeader: string | null): Promise<string> {
  if (!authHeader?.startsWith("Bearer ")) throw new Error("Missing authorization");
  const { data, error } = await supabase.auth.getUser(authHeader.replace("Bearer ", ""));
  if (error || !data.user) throw new Error("Invalid session");
  return data.user.id;
}

// Deletes the CALLER's own account. The caller is identified from their JWT, so
// a user can only ever delete themselves. Removes their craving subscription
// (keyed by email, so it won't cascade) then hard-deletes the auth user; FK
// cascades remove the club/student row and everything hanging off it. Needs the
// service role - which is exactly why this lives in the function, not an RPC.
async function deleteAccount(authHeader: string | null): Promise<{ deleted: boolean }> {
  if (!authHeader?.startsWith("Bearer ")) throw new Error("Missing authorization");
  const { data, error } = await supabase.auth.getUser(authHeader.replace("Bearer ", ""));
  if (error || !data.user) throw new Error("Invalid session");
  const userId = data.user.id;

  const emails = new Set<string>();
  if (data.user.email) emails.add(data.user.email.toLowerCase());
  const { data: profile } = await supabase
    .from("users_extended")
    .select("cornell_email")
    .eq("id", userId)
    .maybeSingle();
  if (profile?.cornell_email) emails.add(profile.cornell_email.toLowerCase());
  if (emails.size > 0) {
    await supabase.from("cravings").delete().in("email", [...emails]);
  }

  const { error: delError } = await supabase.auth.admin.deleteUser(userId);
  if (delError) throw new Error(delError.message);
  return { deleted: true };
}

// ---------- Order emails + actions ----------

async function orderContext(listingId: string) {
  const { data: listing } = await supabase
    .from("listings")
    .select("id, title, brand, pickup_info, pickup_location_id, club_id")
    .eq("id", listingId)
    .single();
  if (!listing) throw new Error("Listing not found");
  const [{ data: club }, { data: location }] = await Promise.all([
    supabase.from("clubs").select("name, email, venmo, zelle_phone").eq("id", listing.club_id).single(),
    listing.pickup_location_id
      ? supabase.from("campus_locations").select("name").eq("id", listing.pickup_location_id).single()
      : Promise.resolve({ data: null }),
  ]);
  return { listing, club, locationName: location?.name ?? listing.pickup_info ?? null };
}

async function emailOrderPlaced(order: OrderRecord): Promise<void> {
  const { listing, club } = await orderContext(order.listing_id);
  const payLines: string[] = [];
  if ((order.payment_method === "venmo" || order.payment_method === "both") && club?.venmo) {
    payLines.push(`Venmo: @${escapeHtml(club.venmo.replace(/^@/, ""))}`);
  }
  if ((order.payment_method === "zelle" || order.payment_method === "both") && club?.zelle_phone) {
    payLines.push(`Zelle: ${escapeHtml(club.zelle_phone)}`);
  }
  const html = emailShell(
    "Order received, one step left",
    paragraph(
      `${escapeHtml(order.orderer_name)}, your order for ${escapeHtml(itemsSummary(order.items_json))} (${dollars(order.total)}) from ${escapeHtml(listing.title)} is in.`,
    ) +
      paragraph(
        `Now pay ${escapeHtml(club?.name ?? "the club")} ${dollars(order.total)}.${payLines.length > 0 ? ` ${payLines.join(". ")}.` : ""}`,
      ) +
      paragraph(
        "The club verifies your payment by hand, then your QR pickup pass arrives in this inbox. No QR yet, that is normal.",
      ),
    "Track my order",
    `${SITE_URL}/orders/${order.id}`,
  );
  await sendEmail(order.orderer_email, `Order received: ${listing.title}`, html);
}

async function verifyPayment(orderId: string, authHeader: string | null): Promise<{ sent: number }> {
  const userId = await requireClubUser(authHeader);

  const { data: order, error: orderError } = await supabase
    .from("orders")
    .select("*")
    .eq("id", orderId)
    .single<OrderRecord & { listing_id: string }>();
  if (orderError || !order) throw new Error("Order not found");
  if (order.status === "cancelled") throw new Error("This order was cancelled");

  const { listing, club, locationName } = await orderContext(order.listing_id);
  if (listing.club_id !== userId) {
    throw new Error("Only the club that owns this listing can verify payments");
  }

  const { data: qrRows } = await supabase
    .from("order_qr_codes")
    .select("id, user_type")
    .eq("order_id", order.id);

  const tokens: Record<string, string> = {};
  const codes: Record<string, string> = {};
  for (const row of qrRows ?? []) {
    const token = await signToken({
      o: order.id,
      t: row.user_type as "orderer" | "proxy",
      ts: Date.now(),
    });
    const pickupCode = genPickupCode();
    tokens[row.user_type] = token;
    codes[row.user_type] = pickupCode;
    const { error } = await supabase
      .from("order_qr_codes")
      .update({ qr_encrypted: token, is_active: true, pickup_code: pickupCode })
      .eq("id", row.id);
    if (error) throw error;
  }

  const { error: statusError } = await supabase
    .from("orders")
    .update({ payment_verified: true, status: "qr_sent" })
    .eq("id", order.id);
  if (statusError) throw statusError;

  const where = locationName ?? "see the listing for pickup details";
  let sent = 0;

  if (tokens.orderer) {
    const html = emailShell(
      "Payment verified, here is your pass",
      paragraph(
        `${escapeHtml(club?.name ?? "The club")} confirmed your payment for ${escapeHtml(listing.title)}. Show this QR at pickup (${escapeHtml(where)}):`,
      ) +
        `<p style="margin:0 0 16px;"><img src="${qrImageUrl(tokens.orderer)}" alt="Your QR pickup pass" width="240" height="240" style="border-radius:12px;border:1px solid #e3ddd0;" /></p>` +
        paragraph(IMAGE_HINT) +
        paragraph(`Pickup code, if the scanner is fussy: <span style="font-family:monospace;font-size:15px;font-weight:700;letter-spacing:2px;">${escapeHtml(codes.orderer)}</span>`) +
        (order.proxy_name
          ? paragraph(
              `${escapeHtml(order.proxy_name)} got their own pass by email. You can disable it anytime from your order page.`,
            )
          : ""),
      "View my order",
      `${SITE_URL}/orders/${order.id}`,
    );
    await sendEmail(order.orderer_email, `Your QR pickup pass: ${listing.title}`, html);
    sent += 1;
    await sleep(550);
  }

  if (tokens.proxy && order.proxy_email && order.proxy_name) {
    const html = emailShell(
      "You are picking up an order",
      paragraph(
        `${escapeHtml(order.orderer_name)} asked you to pick up ${escapeHtml(itemsSummary(order.items_json))} from ${escapeHtml(listing.title)} (${escapeHtml(club?.name ?? "a Cornell club")}). Show this QR at ${escapeHtml(where)}:`,
      ) +
        `<p style="margin:0 0 16px;"><img src="${qrImageUrl(tokens.proxy)}" alt="Proxy QR pickup pass" width="240" height="240" style="border-radius:12px;border:1px solid #e3ddd0;" /></p>` +
        paragraph(IMAGE_HINT) +
        paragraph(`Pickup code, if the scanner is fussy: <span style="font-family:monospace;font-size:15px;font-weight:700;letter-spacing:2px;">${escapeHtml(codes.proxy)}</span>`),
      "See the listing",
      `${SITE_URL}/listing/${listing.id}`,
    );
    await sendEmail(order.proxy_email, `Pickup pass from ${order.orderer_name}`, html);
    sent += 1;
  }

  return { sent };
}

async function scanGroupQr(
  payload: TokenPayload,
  userId: string,
): Promise<Record<string, unknown>> {
  const { data: member } = await supabase
    .from("order_group_members")
    .select("*")
    .eq("id", String(payload.m))
    .single();
  const { data: group } = member
    ? await supabase.from("order_groups").select("*").eq("id", String(payload.g)).single<GroupRecord>()
    : { data: null };
  if (!member || !group || member.group_id !== group.id) {
    return { result: "invalid", message: "Pass record not found" };
  }

  const { listing } = await orderContext(group.listing_id);
  if (listing.club_id !== userId) {
    return { result: "invalid", message: "This pass belongs to another club's listing" };
  }

  const emails = await groupMemberEmails(group.id);
  const holderEmail = emails.find((entry) => entry.user_id === member.user_id)?.email ?? "";
  const { data: profile } = await supabase
    .from("users_extended")
    .select("first_name, last_name")
    .eq("id", member.user_id)
    .maybeSingle();
  const holder = {
    name: `${profile?.first_name ?? "Student"} ${profile?.last_name ?? ""}`.trim(),
    email: holderEmail,
    type: "group member",
  };
  const summary = {
    orderer_name: holder.name,
    listing_title: listing.title,
    items_summary: `1 share of ${group.item_name} (split ${group.total_people} ways)`,
    total: Math.round((group.item_price / Math.max(group.total_people, 1)) * 100) / 100,
  };

  if (group.status === "canceled") {
    return { result: "inactive", message: "This group was canceled", order: summary, holder };
  }
  if (member.status !== "paid" || !member.qr_encrypted) {
    return { result: "inactive", message: "This member's share is not verified yet", order: summary, holder };
  }
  if (member.scanned_at) {
    return {
      result: "already_scanned",
      message: `Already used ${new Date(member.scanned_at).toLocaleString("en-US", { timeZone: "America/New_York" })}`,
      order: summary,
      holder,
    };
  }

  await supabase
    .from("order_group_members")
    .update({ scanned_at: new Date().toISOString() })
    .eq("id", member.id);

  return { result: "picked_up", message: "Share pass accepted. Hand over their portion!", order: summary, holder };
}

// 10-char Crockford base32 (no I/L/O/U). Random single-use code a club can type
// instead of scanning. It's validated by lookup, not as a signature.
function genPickupCode(): string {
  const alphabet = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";
  const bytes = new Uint8Array(10);
  crypto.getRandomValues(bytes);
  let out = "";
  for (const b of bytes) out += alphabet[b % 32];
  return out;
}

// Resolve a typed pickup code into the same payload a scanned token yields, so
// the existing scan checks (ownership, active, already-used) still apply.
async function resolvePickupCode(input: string): Promise<TokenPayload | null> {
  const code = input.toUpperCase();
  if (!/^[0-9A-Z]{10}$/.test(code)) return null;
  const { data: qr } = await supabase
    .from("order_qr_codes")
    .select("order_id, user_type")
    .eq("pickup_code", code)
    .maybeSingle();
  if (qr) return { o: qr.order_id as string, t: qr.user_type as string };
  const { data: gm } = await supabase
    .from("order_group_members")
    .select("id, group_id")
    .eq("pickup_code", code)
    .maybeSingle();
  if (gm) return { g: gm.group_id as string, m: gm.id as string };
  return null;
}

async function scanQr(token: string, authHeader: string | null): Promise<Record<string, unknown>> {
  const userId = await requireClubUser(authHeader);

  let payload = await verifyToken(token.trim());
  if (!payload) {
    payload = await resolvePickupCode(token.trim());
  }
  if (!payload) {
    return { result: "invalid", message: "Not a valid Cornell Craves pass" };
  }

  // Group member pass.
  if (typeof payload.g === "string" && typeof payload.m === "string") {
    return scanGroupQr(payload, userId);
  }
  if (typeof payload.o !== "string") {
    return { result: "invalid", message: "Not a valid Cornell Craves pass" };
  }

  const { data: order } = await supabase
    .from("orders")
    .select("*")
    .eq("id", payload.o)
    .single<OrderRecord>();
  if (!order) {
    return { result: "invalid", message: "Order behind this pass no longer exists" };
  }

  const { listing } = await orderContext(order.listing_id);
  if (listing.club_id !== userId) {
    return { result: "invalid", message: "This pass belongs to another club's listing" };
  }

  const summary = {
    orderer_name: order.orderer_name,
    listing_title: listing.title,
    items_summary: itemsSummary(order.items_json),
    total: order.total,
  };
  const holder =
    payload.t === "proxy"
      ? { name: order.proxy_name ?? "Proxy", email: order.proxy_email ?? "", type: "proxy" }
      : { name: order.orderer_name, email: order.orderer_email, type: "orderer" };

  const { data: qrRow } = await supabase
    .from("order_qr_codes")
    .select("*")
    .eq("order_id", order.id)
    .eq("user_type", payload.t)
    .single();
  if (!qrRow) {
    return { result: "invalid", message: "Pass record not found" };
  }
  if (order.status === "cancelled") {
    return { result: "inactive", message: "This order was cancelled", order: summary, holder };
  }
  // Either the orderer or the proxy picking up retires the whole order, so a
  // second scan of the other pass is rejected here.
  if (order.status === "picked_up") {
    return {
      result: "already_scanned",
      message: "This order was already picked up.",
      order: summary,
      holder,
    };
  }
  if (!order.payment_verified || !qrRow.is_active) {
    return {
      result: "inactive",
      message: "Pass is not active. Payment unverified or the orderer disabled it.",
      order: summary,
      holder,
    };
  }
  if (qrRow.scanned_at) {
    return {
      result: "already_scanned",
      message: `Already used ${new Date(qrRow.scanned_at).toLocaleString("en-US", { timeZone: "America/New_York" })}`,
      order: summary,
      holder,
    };
  }

  const now = new Date().toISOString();
  await supabase
    .from("order_qr_codes")
    .update({ scanned_at: now, scanned_by_user_type: payload.t })
    .eq("id", qrRow.id);
  // Retire every pass on this order (orderer + proxy) so the other one can't be
  // used after the first pickup.
  await supabase
    .from("order_qr_codes")
    .update({ is_active: false })
    .eq("order_id", order.id);
  await supabase
    .from("orders")
    .update({
      status: "picked_up",
      picked_up_by_name: holder.name,
      picked_up_by_email: holder.email,
      picked_up_at: now,
    })
    .eq("id", order.id);

  return {
    result: "picked_up",
    message: "Pass accepted. Hand over the goods!",
    order: summary,
    holder,
  };
}

// ---------- Group orders (split orders) ----------

interface GroupRecord {
  id: string;
  listing_id: string;
  item_name: string;
  item_price: number;
  total_people: number;
  deadline: string;
  status: string;
  created_by: string;
}

async function groupMemberEmails(groupId: string): Promise<{ user_id: string; email: string }[]> {
  const { data: members } = await supabase
    .from("order_group_members")
    .select("user_id")
    .eq("group_id", groupId);
  const result: { user_id: string; email: string }[] = [];
  for (const member of members ?? []) {
    const { data: profile } = await supabase
      .from("users_extended")
      .select("cornell_email")
      .eq("id", member.user_id)
      .maybeSingle();
    let email = profile?.cornell_email ?? "";
    if (!email) {
      const { data: authUser } = await supabase.auth.admin.getUserById(member.user_id);
      email = authUser?.user?.email ?? "";
    }
    if (email) result.push({ user_id: member.user_id, email });
  }
  return result;
}

async function emailGroupMembers(group: GroupRecord, subject: string, bodyHtml: string): Promise<number> {
  const { listing } = await orderContext(group.listing_id);
  const html = emailShell(subject, bodyHtml, "Open my orders", `${SITE_URL}/orders`);
  let sent = 0;
  for (const member of await groupMemberEmails(group.id)) {
    try {
      await sendEmail(member.email, `${subject}: ${listing.title}`, html);
      sent += 1;
    } catch (error) {
      console.error(`Group email failed for ${member.email}:`, error);
    }
    await sleep(550);
  }
  return sent;
}

async function handleGroupStatusChange(group: GroupRecord, previousStatus: string): Promise<number> {
  if (group.status === previousStatus) return 0;
  const share = dollars(group.item_price / Math.max(group.total_people, 1));

  if (group.status === "full") {
    // Group full + payment unlocked, one email covering both.
    return emailGroupMembers(
      group,
      "Your split order is full, payment unlocked",
      paragraph(
        `All ${group.total_people} spots for ${escapeHtml(group.item_name)} are taken. Everyone now pays their share of ${share}.`,
      ) +
        paragraph(
          "You have 24 hours. Pay the club, they verify it, and your personal QR pickup pass lands in this inbox. Unpaid groups cancel automatically at the deadline.",
        ),
    );
  }
  if (group.status === "canceled") {
    return emailGroupMembers(
      group,
      "Your split order was canceled",
      paragraph(
        `The payment window for ${escapeHtml(group.item_name)} closed before everyone paid, so the group was canceled.`,
      ) + paragraph("If the club reactivates it, you will get another email with a fresh deadline."),
    );
  }
  if (group.status === "reactivated") {
    return emailGroupMembers(
      group,
      "Your split order is back on",
      paragraph(
        `The club reactivated the split for ${escapeHtml(group.item_name)}. Anyone who has not paid their ${share} share has 24 hours.`,
      ),
    );
  }
  return 0;
}

async function emailGroupInvite(invite: {
  group_id: string;
  invited_email: string | null;
  invite_link_token: string;
}): Promise<void> {
  if (!invite.invited_email) return; // The open share link is not emailed.
  const { data: group } = await supabase
    .from("order_groups")
    .select("*")
    .eq("id", invite.group_id)
    .single<GroupRecord>();
  if (!group) return;
  const { listing } = await orderContext(group.listing_id);
  const share = dollars(group.item_price / Math.max(group.total_people, 1));
  const html = emailShell(
    "You are invited to split an order",
    paragraph(
      `A friend wants to split ${escapeHtml(group.item_name)} from ${escapeHtml(listing.title)} with you: ${share} each, ${group.total_people} people total.`,
    ) + paragraph("Claim your spot before it fills."),
    "Join the split",
    `${SITE_URL}/invite/${invite.invite_link_token}`,
  );
  await sendEmail(invite.invited_email, `Split ${group.item_name} from ${listing.title}?`, html);
}

async function verifyGroupPayment(memberId: string, authHeader: string | null): Promise<{ ok: true }> {
  const userId = await requireClubUser(authHeader);

  const { data: member } = await supabase
    .from("order_group_members")
    .select("*")
    .eq("id", memberId)
    .single();
  if (!member) throw new Error("Group member not found");

  const { data: group } = await supabase
    .from("order_groups")
    .select("*")
    .eq("id", member.group_id)
    .single<GroupRecord>();
  if (!group) throw new Error("Group not found");

  const { listing, club, locationName } = await orderContext(group.listing_id);
  if (listing.club_id !== userId) {
    throw new Error("Only the club that owns this listing can verify payments");
  }
  if (!["full", "payment_in_progress", "reactivated"].includes(group.status)) {
    throw new Error("This group is not in a payable state");
  }

  const token = await signToken({ g: group.id, m: memberId, ts: Date.now() });
  const pickupCode = genPickupCode();
  await supabase
    .from("order_group_members")
    .update({ status: "paid", qr_encrypted: token, pickup_code: pickupCode })
    .eq("id", memberId);

  if (group.status !== "payment_in_progress") {
    await supabase.from("order_groups").update({ status: "payment_in_progress" }).eq("id", group.id);
  }

  const { data: remaining } = await supabase
    .from("order_group_members")
    .select("id")
    .eq("group_id", group.id)
    .neq("status", "paid");
  // Passes go out only once the WHOLE group has paid - until then the club is
  // just checking members off.
  if ((remaining ?? []).length > 0) {
    return { ok: true };
  }

  await supabase.from("order_groups").update({ status: "paid" }).eq("id", group.id);

  // Everyone has paid: email each member their individual pass.
  const { data: members } = await supabase
    .from("order_group_members")
    .select("user_id, qr_encrypted, pickup_code")
    .eq("group_id", group.id);
  const emails = await groupMemberEmails(group.id);
  const where = locationName ?? "see the listing for pickup details";
  for (const m of members ?? []) {
    const target = emails.find((entry) => entry.user_id === m.user_id);
    if (!target || !m.qr_encrypted) continue;
    const html = emailShell(
      "Your group is fully paid, here is your pass",
      paragraph(
        `${escapeHtml(club?.name ?? "The club")} confirmed everyone's share of ${escapeHtml(group.item_name)} (${escapeHtml(listing.title)}). Show this QR at ${escapeHtml(where)}:`,
      ) +
        `<p style="margin:0 0 16px;"><img src="${qrImageUrl(m.qr_encrypted)}" alt="Your group QR pickup pass" width="240" height="240" style="border-radius:12px;border:1px solid #e3ddd0;" /></p>` +
        paragraph(IMAGE_HINT) +
        paragraph(
          `Pickup code, if the scanner is fussy: <span style="font-family:monospace;font-size:15px;font-weight:700;letter-spacing:2px;">${escapeHtml(m.pickup_code ?? "")}</span>`,
        ),
      "View my group",
      `${SITE_URL}/orders`,
    );
    await sendEmail(target.email, `Your QR pass: ${group.item_name} split`, html);
    await sleep(550);
  }

  return { ok: true };
}

async function reactivateGroup(groupId: string, authHeader: string | null): Promise<{ ok: true }> {
  const userId = await requireClubUser(authHeader);
  const { data: group } = await supabase
    .from("order_groups")
    .select("*")
    .eq("id", groupId)
    .single<GroupRecord>();
  if (!group) throw new Error("Group not found");
  const { listing } = await orderContext(group.listing_id);
  if (listing.club_id !== userId) {
    throw new Error("Only the club that owns this listing can reactivate groups");
  }
  if (group.status !== "canceled") throw new Error("Only canceled groups can be reactivated");

  await supabase
    .from("order_groups")
    .update({ status: "reactivated", deadline: new Date(Date.now() + 24 * 3_600_000).toISOString() })
    .eq("id", groupId);
  // The status-change webhook emails members.
  return { ok: true };
}

async function autoCancelGroups(): Promise<{ canceled: number }> {
  // Called hourly by pg_cron (see NEXT_STEPS). The status-change webhook
  // emails each affected group's members.
  const { data, error } = await supabase
    .from("order_groups")
    .update({ status: "canceled" })
    .in("status", ["filling", "full", "payment_in_progress", "reactivated"])
    .lt("deadline", new Date().toISOString())
    .select("id");
  if (error) throw error;
  return { canceled: (data ?? []).length };
}

// ---------- Webhook handlers ----------

async function notifyCravings(listing: ListingRecord): Promise<{ sent: number }> {
  if (!listing.active) return { sent: 0 };

  const { data: cravings, error: cravingsError } = await supabase
    .from("cravings")
    .select("id, email")
    .contains("brands", [listing.brand]);
  if (cravingsError) throw cravingsError;
  if (!cravings || cravings.length === 0) return { sent: 0 };

  const { data: logged, error: logError } = await supabase
    .from("notifications_log")
    .select("craving_id")
    .eq("listing_id", listing.id);
  if (logError) throw logError;

  const alreadySent = new Set((logged ?? []).map((row) => row.craving_id));
  const targets = cravings.filter((craving) => !alreadySent.has(craving.id));

  const pickup = listing.pickup_info
    ? paragraph(`Pickup: ${escapeHtml(listing.pickup_info)}`)
    : "";
  const html = emailShell(
    `${escapeHtml(listing.brand)} just dropped on campus`,
    paragraph(
      `${escapeHtml(listing.title)} is live right now. You asked us to ping you when ${escapeHtml(listing.brand)} showed up, so here it is.`,
    ) + pickup,
    "See the drop",
    `${SITE_URL}/listing/${listing.id}`,
  );

  let sent = 0;
  for (const craving of targets) {
    try {
      await sendEmail(craving.email, `${listing.brand} just dropped on campus`, html);
      const { error: insertError } = await supabase
        .from("notifications_log")
        .insert({ craving_id: craving.id, listing_id: listing.id });
      if (insertError) throw insertError;
      sent += 1;
    } catch (error) {
      // One bad address should not block the rest of the queue.
      console.error(`Failed to notify ${craving.email}:`, error);
    }
    // Stay under Brevo's send rate limit.
    await sleep(550);
  }
  return { sent };
}

async function welcomeClub(club: ClubRecord): Promise<void> {
  const html = emailShell(
    `You are in, ${escapeHtml(club.name)}!`,
    paragraph(
      "Your club is approved. You can now post fundraiser drops, set pickup slots, save recurring templates, and watch your analytics.",
    ),
    "Open your dashboard",
    `${SITE_URL}/dashboard`,
  );
  await sendEmail(club.email, "You are in! Welcome to Cornell Craves", html);
}

async function confirmReservation(reservation: ReservationRecord): Promise<void> {
  const { data: slot, error: slotError } = await supabase
    .from("pickup_slots")
    .select("start_time, end_time, listing_id")
    .eq("id", reservation.slot_id)
    .single();
  if (slotError || !slot) throw slotError ?? new Error("Slot not found");

  const { data: listing, error: listingError } = await supabase
    .from("listings")
    .select("id, title, brand, pickup_info, pickup_location_id, club_id")
    .eq("id", slot.listing_id)
    .single();
  if (listingError || !listing) throw listingError ?? new Error("Listing not found");

  const [{ data: club }, { data: location }] = await Promise.all([
    supabase.from("clubs").select("name, venmo").eq("id", listing.club_id).single(),
    listing.pickup_location_id
      ? supabase.from("campus_locations").select("name").eq("id", listing.pickup_location_id).single()
      : Promise.resolve({ data: null }),
  ]);

  const where = location?.name ?? listing.pickup_info ?? "see the listing for pickup details";
  const html = emailShell(
    "Your pickup is reserved",
    paragraph(
      `${escapeHtml(reservation.user_name)}, you are down for ${reservation.quantity} ${reservation.quantity === 1 ? "item" : "items"} of ${escapeHtml(listing.title)} (${escapeHtml(listing.brand)}) from ${escapeHtml(club?.name ?? "the club")}.`,
    ) +
      paragraph(`When: ${escapeHtml(formatSlotWindow(slot.start_time, slot.end_time))}`) +
      paragraph(`Where: ${escapeHtml(where)}`) +
      paragraph(
        club?.venmo
          ? `Pay ahead on Venmo (@${escapeHtml(club.venmo.replace(/^@/, ""))}) or at pickup.`
          : "Pay at pickup.",
      ),
    "Manage my pickups",
    `${SITE_URL}/reservations`,
  );
  await sendEmail(reservation.user_email, `Reserved: ${listing.title}`, html);
}

async function clubEmailForListing(listingId: string): Promise<{ email: string; title: string } | null> {
  const { data: listing } = await supabase
    .from("listings")
    .select("id, title, club_id")
    .eq("id", listingId)
    .single();
  if (!listing) return null;
  const { data: club } = await supabase.from("clubs").select("email").eq("id", listing.club_id).single();
  if (!club) return null;
  return { email: club.email, title: listing.title };
}

async function notifyClubOfReview(review: ReviewRecord): Promise<void> {
  const target = await clubEmailForListing(review.listing_id);
  if (!target) return;
  const stars = `${review.rating} of 5 stars`;
  const html = emailShell(
    "New review on your drop",
    paragraph(
      `${escapeHtml(review.reviewer_name.split(/\s+/)[0] ?? "A student")} rated "${escapeHtml(target.title)}" ${stars}: "${escapeHtml(review.title)}".`,
    ) + paragraph("Replying publicly builds trust; reviews with club responses convert better."),
    "Read and respond",
    `${SITE_URL}/listing/${review.listing_id}/reviews`,
  );
  await sendEmail(target.email, `New ${review.rating}-star review on ${target.title}`, html);
}

async function notifyClubOfQuestion(entry: QARecord): Promise<void> {
  const target = await clubEmailForListing(entry.listing_id);
  if (!target) return;
  const html = emailShell(
    "New question on your drop",
    paragraph(`Someone asked about "${escapeHtml(target.title)}":`) +
      paragraph(`"${escapeHtml(entry.question)}"`) +
      paragraph("Answers are public and save you the DMs."),
    "Answer it",
    `${SITE_URL}/listing/${entry.listing_id}/qa`,
  );
  await sendEmail(target.email, `New question on ${target.title}`, html);
}

// ---------- Direct action: send_reminders ----------

async function sendReminders(slotId: string, authHeader: string | null): Promise<{ sent: number }> {
  if (!authHeader?.startsWith("Bearer ")) {
    throw new Error("Missing authorization");
  }
  const { data: userData, error: userError } = await supabase.auth.getUser(
    authHeader.replace("Bearer ", ""),
  );
  if (userError || !userData.user) {
    throw new Error("Invalid session");
  }

  const { data: slot, error: slotError } = await supabase
    .from("pickup_slots")
    .select("id, start_time, end_time, listing_id")
    .eq("id", slotId)
    .single();
  if (slotError || !slot) throw new Error("Slot not found");

  const { data: listing } = await supabase
    .from("listings")
    .select("id, title, brand, pickup_info, pickup_location_id, club_id")
    .eq("id", slot.listing_id)
    .single();
  if (!listing || listing.club_id !== userData.user.id) {
    throw new Error("Only the club that owns this listing can send reminders");
  }

  const { data: location } = listing.pickup_location_id
    ? await supabase.from("campus_locations").select("name").eq("id", listing.pickup_location_id).single()
    : { data: null };

  const { data: reservations } = await supabase
    .from("reservations")
    .select("id, user_email, user_name, quantity")
    .eq("slot_id", slotId);

  const where = location?.name ?? listing.pickup_info ?? "see the listing for pickup details";
  const html = emailShell(
    "Pickup reminder",
    paragraph(
      `Your ${escapeHtml(listing.brand)} pickup for ${escapeHtml(listing.title)} is coming up.`,
    ) +
      paragraph(`When: ${escapeHtml(formatSlotWindow(slot.start_time, slot.end_time))}`) +
      paragraph(`Where: ${escapeHtml(where)}`),
    "View my reservation",
    `${SITE_URL}/reservations`,
  );

  let sent = 0;
  for (const reservation of reservations ?? []) {
    try {
      await sendEmail(reservation.user_email, `Reminder: ${listing.title} pickup`, html);
      sent += 1;
    } catch (error) {
      console.error(`Failed reminder to ${reservation.user_email}:`, error);
    }
    await sleep(550);
  }
  return { sent };
}

// ---------- Router ----------

const CORS_HEADERS: Record<string, string> = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-api-version",
};

function withCors(res: Response): Response {
  for (const [key, value] of Object.entries(CORS_HEADERS)) res.headers.set(key, value);
  return res;
}

async function handleRequest(req: Request): Promise<Response> {
  if (req.method !== "POST") {
    return new Response("Method not allowed", { status: 405 });
  }

  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return Response.json({ ok: false, error: "Invalid JSON body" }, { status: 400 });
  }

  try {
    // Direct action calls from the app.
    if (body.action === "send_reminders" && typeof body.slot_id === "string") {
      const result = await sendReminders(body.slot_id, req.headers.get("Authorization"));
      return Response.json({ ok: true, ...result });
    }

    if (body.action === "verify_payment" && typeof body.order_id === "string") {
      const result = await verifyPayment(body.order_id, req.headers.get("Authorization"));
      return Response.json({ ok: true, ...result });
    }

    if (body.action === "scan_qr" && typeof body.token === "string") {
      const result = await scanQr(body.token, req.headers.get("Authorization"));
      return Response.json({ ok: true, ...result });
    }

    if (body.action === "verify_group_payment" && typeof body.member_id === "string") {
      const result = await verifyGroupPayment(body.member_id, req.headers.get("Authorization"));
      return Response.json(result);
    }

    if (body.action === "reactivate_group" && typeof body.group_id === "string") {
      const result = await reactivateGroup(body.group_id, req.headers.get("Authorization"));
      return Response.json(result);
    }

    if (body.action === "delete_account") {
      const result = await deleteAccount(req.headers.get("Authorization"));
      return Response.json({ ok: true, ...result });
    }

    // Called hourly by pg_cron with the service role key.
    if (body.action === "auto_cancel_groups") {
      const result = await autoCancelGroups();
      return Response.json({ ok: true, ...result });
    }

    // Database webhooks.
    const payload = body as unknown as WebhookPayload;

    if (payload.table === "listings" && payload.type === "INSERT" && payload.record) {
      const result = await notifyCravings(payload.record as unknown as ListingRecord);
      return Response.json({ ok: true, ...result });
    }

    // Brand corrected after posting: alert subscribers of the NEW brand. The
    // notifications_log (craving_id, listing_id) dedupe means anyone already
    // notified for this listing - including under the old brand - is skipped,
    // so a single listing never double-notifies a person (build spec 5 #15).
    if (payload.table === "listings" && payload.type === "UPDATE" && payload.record) {
      const next = payload.record as unknown as ListingRecord;
      const prev = payload.old_record as unknown as ListingRecord | null;
      if (prev && next.brand && next.brand !== prev.brand) {
        const result = await notifyCravings(next);
        return Response.json({ ok: true, ...result });
      }
      return Response.json({ ok: true, skipped: "no brand change" });
    }

    if (
      payload.table === "clubs" &&
      payload.type === "UPDATE" &&
      payload.record &&
      (payload.record as unknown as ClubRecord).approved === true &&
      (payload.old_record as unknown as ClubRecord | null)?.approved === false
    ) {
      const club = payload.record as unknown as ClubRecord;
      await welcomeClub(club);
      return Response.json({ ok: true, welcomed: club.email });
    }

    if (payload.table === "reservations" && payload.type === "INSERT" && payload.record) {
      await confirmReservation(payload.record as unknown as ReservationRecord);
      return Response.json({ ok: true, confirmed: true });
    }

    if (payload.table === "reviews" && payload.type === "INSERT" && payload.record) {
      await notifyClubOfReview(payload.record as unknown as ReviewRecord);
      return Response.json({ ok: true, notified: "club" });
    }

    if (payload.table === "qa" && payload.type === "INSERT" && payload.record) {
      await notifyClubOfQuestion(payload.record as unknown as QARecord);
      return Response.json({ ok: true, notified: "club" });
    }

    if (payload.table === "orders" && payload.type === "INSERT" && payload.record) {
      await emailOrderPlaced(payload.record as unknown as OrderRecord);
      return Response.json({ ok: true, notified: "orderer" });
    }

    if (payload.table === "order_groups" && payload.type === "UPDATE" && payload.record) {
      const sent = await handleGroupStatusChange(
        payload.record as unknown as GroupRecord,
        ((payload.old_record as unknown as GroupRecord | null)?.status ?? "") as string,
      );
      return Response.json({ ok: true, sent });
    }

    if (payload.table === "order_group_invitations" && payload.type === "INSERT" && payload.record) {
      await emailGroupInvite(
        payload.record as unknown as {
          group_id: string;
          invited_email: string | null;
          invite_link_token: string;
        },
      );
      return Response.json({ ok: true });
    }

    return Response.json({ ok: true, skipped: true });
  } catch (error) {
    console.error("notify-cravings failed:", error);
    return Response.json({ ok: false, error: String(error) }, { status: 500 });
  }
}

Deno.serve(async (req) => {
  // Browsers send a CORS preflight before invoking from the app; answer it,
  // and attach CORS headers to every real response so the app can read it.
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: CORS_HEADERS });
  }
  return withCors(await handleRequest(req));
});
