// Payload-shape check: does what the database RETURNS match what the UI READS?
//
// contract.mjs proves every request the app sends is well-formed. This file
// proves the responses are, by driving real scenarios (a split group from
// creation to fully paid, a solo order, a reservation, the admin dashboard)
// and then comparing the JSON each RPC produces against:
//
//   1. the hand-written TypeScript type in src/types/database.ts
//      (every non-optional field must be present; unknown keys are INFO), and
//   2. the property names the pages actually dereference on that payload
//      (`group.my_qr`, `member.payment_handle`, ...), which is the stricter,
//      more honest contract since a missing one renders as "undefined".
//
//   node supabase/tests/payload-shape.mjs
import { boot, asUser, createAuthUser, check, summary } from "./harness.mjs";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const typesSrc = readFileSync(join(ROOT, "src/types/database.ts"), "utf8");

// ---------------------------------------------------------------- TS type parser
function balancedEnd(src, open) {
  let depth = 0;
  for (let i = open; i < src.length; i += 1) {
    if (src[i] === "{") depth += 1;
    else if (src[i] === "}") { depth -= 1; if (depth === 0) return i + 1; }
  }
  return src.length;
}
/** { required: Set, optional: Set } for `export type Name = Base & { ... }`. */
function tsType(name) {
  const m = new RegExp(`export type ${name}\\s*=`).exec(typesSrc);
  if (!m) throw new Error(`type ${name} not found`);
  const start = m.index + m[0].length;
  const brace = typesSrc.indexOf("{", start);
  const prefix = typesSrc.slice(start, brace);
  const body = typesSrc.slice(brace, balancedEnd(typesSrc, brace));
  const required = new Set(), optional = new Set();
  for (const base of prefix.split("&").map((s) => s.trim()).filter((s) => /^[A-Z]\w*$/.test(s))) {
    const b = tsType(base);
    b.required.forEach((k) => required.add(k));
    b.optional.forEach((k) => optional.add(k));
  }
  // fields at depth 1 only
  let depth = 0;
  for (const line of body.split("\n")) {
    const opens = (line.match(/\{/g) ?? []).length, closes = (line.match(/\}/g) ?? []).length;
    if (depth === 1) {
      const f = /^\s*(?:readonly\s+)?([a-z_][a-zA-Z0-9_]*)(\?)?\s*:/.exec(line);
      if (f) (f[2] ? optional : required).add(f[1]);
    }
    depth += opens - closes;
  }
  return { required, optional };
}

/** Property names dereferenced as `<var>.<prop>` in the given files. */
function uiReads(files, vars) {
  const props = new Set();
  const re = new RegExp(`\\b(?:${vars.join("|")})\\.([a-z_][a-z0-9_]*)\\b`, "g");
  for (const f of files) {
    const src = readFileSync(join(ROOT, f), "utf8");
    let m;
    while ((m = re.exec(src))) props.add(m[1]);
  }
  return props;
}

function shapeCheck(label, obj, type, reads = new Set(), { ignoreReads = [] } = {}) {
  const keys = new Set(Object.keys(obj ?? {}));
  const t = tsType(type);
  const missingReq = [...t.required].filter((k) => !keys.has(k));
  check(`${label}: every required ${type} field present`, missingReq.length === 0, `missing: ${missingReq.join(", ")}`);
  const unknown = [...keys].filter((k) => !t.required.has(k) && !t.optional.has(k));
  if (unknown.length) console.log(`  INFO  ${label}: keys not declared on ${type}: ${unknown.join(", ")}`);
  const missingReads = [...reads].filter((k) => !keys.has(k) && !ignoreReads.includes(k));
  check(`${label}: every field the UI reads is present`, missingReads.length === 0, `UI reads but payload lacks: ${missingReads.join(", ")}`);
}

// ---------------------------------------------------------------- boot + seed
const db = await boot();
const future = new Date(Date.now() + 48 * 3600e3).toISOString();
const ADMIN_EMAIL = "admin@cornell.edu";
await db.exec(`insert into public.admin_emails (email, role, status) values ('${ADMIN_EMAIL}', 'owner', 'active')
  on conflict (email) do update set role='owner', status='active';`);
const admin = await createAuthUser(db, ADMIN_EMAIL);
const clubUser = await createAuthUser(db, "shapeclub@cornell.edu", { club_name: "Shape Club" });
const alice = await createAuthUser(db, "alice9@cornell.edu", { full_name: "Alice Adams" });
const bob = await createAuthUser(db, "bob9@cornell.edu", { full_name: "Bob Brown" });
const carol = await createAuthUser(db, "carol9@cornell.edu", { full_name: "Carol Cruz" });
await asUser(db, admin, () => db.query(`select public.admin_set_club_approved($1, true)`, [clubUser.id]));
await db.query(
  `update public.clubs set venmo='shape-club', zelle_phone='607-555-0199', member_options='{Aarav,Maya}', groups_enabled=true where id=$1`,
  [clubUser.id],
);
for (const u of [alice, bob, carol]) {
  await db.query(`insert into public.users_extended (id, email, name, netid) values ($1,$2,$3,$4)
                  on conflict (id) do update set name = excluded.name, netid = excluded.netid`,
    [u.id, u.email, u.email.split("@")[0], u.email.split("@")[0]]).catch(() => {});
}
const { rows: [{ id: listing }] } = await db.query(
  `insert into public.listings (club_id, brand, title, items, contact_email, active, expires_at, recommender_enabled, pickup_info)
   values ($1,'Crumbl','Shape drop',$2::jsonb,'x@cornell.edu',true,$3,true,'Duffield lobby') returning id`,
  [clubUser.id, JSON.stringify([{ name: "Dozen", price: 24, quantity: 12 }, { name: "Single", price: 5, quantity: 1 }]), future],
);
const ACK = "2026-08-21.v3";
const rpc = (user, sql, params) => asUser(db, user, async () => (await db.query(sql, params)).rows);
const one = async (user, sql, params) => (await rpc(user, sql, params))[0]?.r;

const GROUP_FILES = ["src/pages/MyOrders.tsx", "src/pages/ClubOrders.tsx", "src/pages/InvitePage.tsx", "src/components/GroupMembers.tsx",
  "src/components/GroupInvitationCard.tsx", "src/components/GroupInviteLink.tsx", "src/pages/ClubAnalytics.tsx", "src/components/DropPurchaseList.tsx"];
const groupReads = uiReads(GROUP_FILES, ["group", "g", "grp"]);
const inviteReads = uiReads(["src/components/GroupInvitationCard.tsx", "src/pages/MyOrders.tsx"], ["invite", "inv"]);
const memberReads = uiReads(GROUP_FILES, ["member", "m", "mem"]);
// Properties read on *other* objects that happen to share a variable name.
const NOT_GROUP = ["length", "map", "filter", "find", "some", "every", "error", "data"]; // array methods / PromiseSettled fields are not payload keys
/** Rows of a table-returning function, or the unwrapped jsonb of a json one. */
const rowsOf = async (user, fn, params = []) => {
  const ph = params.map((_, i) => `$${i + 1}`).join(",");
  const rows = await rpc(user, `select to_jsonb(t) as r from public.${fn}(${ph}) t`, params);
  return rows.map((x) => (x.r && Object.keys(x.r).length === 1 && fn in x.r ? x.r[fn] : x.r));
};

// ---------------------------------------------------------------- split group lifecycle
console.log("G: split group payloads through the whole lifecycle\n");
const created = await one(alice, `select public.create_order_group($1,'Dozen',2,$2,'private',$3) as r`, [listing, [bob.email], ACK]);
check("create_order_group returns { group_id, open_token }", created && "group_id" in created && "open_token" in created, JSON.stringify(created));
const g1 = created.group_id;

let mine = await one(alice, `select public.get_my_groups() as r`);
mine = Array.isArray(mine) ? mine : (await rpc(alice, `select public.get_my_groups() as r`)).map((x) => x.r);
const mineG1 = mine.find((g) => g.id === g1);
check("get_my_groups (creator) returns the new group", Boolean(mineG1));
shapeCheck("get_my_groups filling", mineG1, "GroupDetails", new Set([...groupReads].filter((k) => !["invite_token"].includes(k))), { ignoreReads: NOT_GROUP });
check("filling: my_qr is empty and my_pickup_code null before verification", mineG1.my_qr === "" && mineG1.my_pickup_code == null, JSON.stringify({ q: mineG1.my_qr, c: mineG1.my_pickup_code }));
check("filling: creator sees themselves in members with is_creator", mineG1.members.some((m) => m.user_id === alice.id && m.is_creator === true));
for (const m of mineG1.members) shapeCheck("get_my_groups member", m, "GroupMemberView", new Set([...memberReads].filter((k) => !["email", "netid"].includes(k))), { ignoreReads: NOT_GROUP });

const invites = (await rpc(bob, `select public.get_my_group_invites() as r`)).map((x) => x.r).flat();
const inv = invites.find((g) => g.id === g1);
check("get_my_group_invites (invitee) returns the pending invite", Boolean(inv));
shapeCheck("get_my_group_invites", inv, "GroupDetails", new Set([...inviteReads, "invite_token"]), { ignoreReads: NOT_GROUP });
check("invite payload carries invite_token", typeof inv.invite_token === "string" && inv.invite_token.length > 8);
check("invite payload does not leak co-member payment handles", inv.members.every((m) => m.payment_handle == null));

// public group -> anon preview via open token
const pub = await one(carol, `select public.create_order_group($1,'Dozen',2,'{}','public',$2) as r`, [listing, ACK]);
check("public group has an open_token", typeof pub.open_token === "string" && pub.open_token.length > 8);
const anonView = await one(null, `select public.get_group_by_token($1) as r`, [pub.open_token]);
check("get_group_by_token resolves for anon", Boolean(anonView) && anonView.id === pub.group_id);
shapeCheck("get_group_by_token (anon)", anonView, "GroupDetails", uiReads(["src/pages/InvitePage.tsx"], ["group"]), { ignoreReads: NOT_GROUP });
check("anon preview never contains email/netid/handle", anonView.members.every((m) => !("email" in m) && !("netid" in m) && m.payment_handle == null));
check("anon preview never contains my_qr / my_pickup_code", !("my_qr" in anonView) || anonView.my_qr === "");

// bob accepts -> full
await rpc(bob, `select public.accept_group_invite($1,$2)`, [inv.invite_token, ACK]);
await rpc(bob, `select public.set_group_member_recommender($1,'Maya')`, [g1]);
let clubGroups = (await rpc(clubUser, `select public.get_club_groups() as r`)).map((x) => x.r).flat();
let cg1 = clubGroups.find((g) => g.id === g1);
check("get_club_groups sees the full group", cg1 && cg1.status === "full" && cg1.filled_count === 2, JSON.stringify({ s: cg1?.status, f: cg1?.filled_count }));
shapeCheck("get_club_groups full", cg1, "GroupDetails", groupReads, { ignoreReads: [...NOT_GROUP, "my_qr", "my_pickup_code", "my_status", "invite_token", "open_token"] });
for (const m of cg1.members) shapeCheck("get_club_groups member", m, "GroupMemberView", memberReads, { ignoreReads: NOT_GROUP });
check("club sees member email + netid (053)", cg1.members.every((m) => typeof m.email === "string" && m.email.includes("@")));
check("bob's recommender pick is on his member row", cg1.members.find((m) => m.user_id === bob.id)?.recommended_by === "Maya");

// club opens payment early -> payment_in_progress
const opened = await one(clubUser, `select public.open_group_payment($1, null) as r`, [g1]);
check("open_group_payment returns { opened }", opened && typeof opened.opened === "number", JSON.stringify(opened));
await rpc(alice, `select public.set_group_member_payment($1,'venmo','@alice')`, [g1]);
await rpc(bob, `select public.set_group_member_payment($1,'zelle','607-555-0100')`, [g1]);
mine = (await rpc(alice, `select public.get_my_groups() as r`)).map((x) => x.r).flat();
const payingG1 = mine.find((g) => g.id === g1);
check("payment_in_progress: status + share_amount + club handles present", payingG1.status === "payment_in_progress" && payingG1.share_amount === 12 && payingG1.club_venmo === "shape-club" && payingG1.club_zelle === "607-555-0199", JSON.stringify({ s: payingG1.status, share: payingG1.share_amount, v: payingG1.club_venmo, z: payingG1.club_zelle }));
check("co-member sees bob's payment handle (disclosed in SPLIT_RULES)", payingG1.members.find((m) => m.user_id === bob.id)?.payment_handle === "607-555-0100");
check("my_status is pending_payment while owing", payingG1.my_status === "pending_payment", payingG1.my_status);
check("deadline (payment window) is ~24h out", payingG1.deadline && new Date(payingG1.deadline) - Date.now() > 23 * 3600e3);

// extend payment deadline by 2h for this one group
const ext = await one(clubUser, `select public.club_extend_deadlines('payment', 2, $1, null) as r`, [g1]);
check("club_extend_deadlines returns { changed }", ext && ext.changed === 1, JSON.stringify(ext));

// club verifies (mirror of the edge function's verifyGroupPayment, which runs as service role)
async function verifyMember(memberId) {
  const { rows: [m] } = await db.query(`select * from public.order_group_members where id=$1`, [memberId]);
  const { rows: [g] } = await db.query(`select * from public.order_groups where id=$1`, [m.group_id]);
  if (!["payment_in_progress", "reactivated"].includes(g.status)) throw new Error("payment not open");
  await db.query(`update public.order_group_members set status='paid', qr_encrypted=$2, pickup_code=$3 where id=$1 and status<>'paid'`, [memberId, `tok-${memberId.slice(0, 8)}`, memberId.slice(0, 10).toUpperCase()]);
  const { rows: rem } = await db.query(`select id from public.order_group_members where group_id=$1 and status<>'paid'`, [g.id]);
  if (rem.length === 0) await db.query(`update public.order_groups set status='paid' where id=$1 and status in ('payment_in_progress','reactivated')`, [g.id]);
}
const aliceMember = payingG1.members.find((m) => m.user_id === alice.id);
await verifyMember(aliceMember.id);
mine = (await rpc(alice, `select public.get_my_groups() as r`)).map((x) => x.r).flat();
let half = mine.find((g) => g.id === g1);
check("after ONE verification: alice is 'paid' but her pass is still withheld", half.my_status === "paid" && half.my_qr === "" && half.my_pickup_code == null, JSON.stringify({ s: half.my_status, q: half.my_qr, c: half.my_pickup_code }));
const bobMember = payingG1.members.find((m) => m.user_id === bob.id);
await verifyMember(bobMember.id);
mine = (await rpc(alice, `select public.get_my_groups() as r`)).map((x) => x.r).flat();
const doneG1 = mine.find((g) => g.id === g1);
check("after ALL verified: group paid and alice's my_qr + my_pickup_code released", doneG1.status === "paid" && doneG1.my_qr.startsWith("tok-") && typeof doneG1.my_pickup_code === "string", JSON.stringify({ s: doneG1.status, q: doneG1.my_qr, c: doneG1.my_pickup_code }));
const bobView = (await rpc(bob, `select public.get_my_groups() as r`)).map((x) => x.r).flat().find((g) => g.id === g1);
check("bob gets HIS OWN pass, not alice's", bobView.my_qr === `tok-${bobMember.id.slice(0, 8)}` && bobView.my_qr !== doneG1.my_qr);
shapeCheck("get_my_groups paid", doneG1, "GroupDetails", groupReads, { ignoreReads: [...NOT_GROUP, "invite_token"] });

// reactivate path on a canceled group (fill mode)
const g3 = (await one(alice, `select public.create_order_group($1,'Dozen',2,'{}','public',$2) as r`, [listing, ACK])).group_id;
await db.query(`update public.order_groups set order_deadline = now() - interval '1 minute' where id=$1`, [g3]);
await db.query(`select public.process_group_deadlines()`);
check("unfilled group past order deadline is canceled by the job", (await db.query(`select status from public.order_groups where id=$1`, [g3])).rows[0].status === "canceled");
const react = await one(clubUser, `select public.reactivate_group($1) as r`, [g3]);
check("reactivate_group returns { mode: 'fill' } for a never-filled group", react && react.mode === "fill", JSON.stringify(react));
const reG3 = (await rpc(alice, `select public.get_my_groups() as r`)).map((x) => x.r).flat().find((g) => g.id === g3);
check("reactivated (fill) group is 'filling' again with a fresh order_deadline", reG3.status === "filling" && new Date(reG3.order_deadline) > new Date(), JSON.stringify({ s: reG3.status, d: reG3.order_deadline }));

// join_or_create_public_group shape
const joined = await one(bob, `select public.join_or_create_public_group($1,'Dozen',2,$2) as r`, [listing, ACK]);
check("join_or_create_public_group returns { group_id, joined }", joined && "group_id" in joined && typeof joined.joined === "boolean", JSON.stringify(joined));

// ---------------------------------------------------------------- solo order
console.log("\nO: solo order payloads\n");
const orderId = await one(alice, `select public.create_order($1,'Alice Adams',$2,'aa123',$3::jsonb,'venmo','@alice',null,'Proxy Pat','pat@cornell.edu','pp12') as r`,
  [listing, alice.email, JSON.stringify([{ name: "Single", qty: 2 }])]);
check("create_order returns a uuid", typeof orderId === "string" && orderId.length === 36, String(orderId));
await rpc(alice, `select public.set_order_recommender($1,'Aarav')`, [orderId]);
const myOrders = (await rpc(alice, `select public.get_my_orders($1) as r`, [alice.email])).map((x) => x.r).flat();
const myOrder = myOrders.find((o) => o.id === orderId) ?? myOrders[0];
check("get_my_orders returns the order", Boolean(myOrder));
const orderReads = uiReads(["src/pages/MyOrders.tsx", "src/pages/OrderDetail.tsx", "src/lib/orders.ts"], ["order", "o"]);
shapeCheck("get_my_orders", myOrder, "MyOrder", orderReads, { ignoreReads: [...NOT_GROUP, "order_qr_codes", "items_summary", "scanned_at", "user_type"] });
check("order has two qr codes (orderer + proxy)", Array.isArray(myOrder.qr_codes) && myOrder.qr_codes.length === 2, JSON.stringify(myOrder.qr_codes?.length));
for (const q of myOrder.qr_codes) shapeCheck("qr code", q, "OrderQRCode", uiReads(["src/pages/OrderDetail.tsx", "src/pages/MyOrders.tsx"], ["qr", "code"]), { ignoreReads: NOT_GROUP });
check("recommended_by saved on the order", myOrder.recommended_by === "Aarav", myOrder.recommended_by);

// ---------------------------------------------------------------- reservation
console.log("\nV: reservation payloads\n");
const { rows: [{ id: slot }] } = await db.query(
  `insert into public.pickup_slots (listing_id, start_time, end_time, max_reservations) values ($1, now() + interval '1 day', now() + interval '1 day 1 hour', 10) returning id`, [listing]);
await rpc(alice, `select public.create_reservation($1,$2,'Alice Adams',2,'nut allergy')`, [slot, alice.email]);
const res = (await rowsOf(alice, "get_my_reservations", [alice.email]))[0];
check("get_my_reservations returns the reservation", Boolean(res));
shapeCheck("get_my_reservations", res, "MyReservation", uiReads(["src/components/ReservationCard.tsx", "src/pages/MyOrders.tsx"], ["reservation", "r"]), { ignoreReads: NOT_GROUP });

// ---------------------------------------------------------------- club + admin dashboards
console.log("\nD: dashboard payloads\n");
const stats = await one(clubUser, `select public.club_dashboard_stats() as r`);
shapeCheck("club_dashboard_stats", stats, "ClubDashboardStats", uiReads(["src/pages/Dashboard.tsx"], ["stats"]), { ignoreReads: NOT_GROUP });
await rpc(clubUser, `select public.request_brand('Levain')`);
const adminReads = (vars) => uiReads(["src/pages/Admin.tsx", "src/components/admin/AdminRoster.tsx", "src/components/admin/AdminInsights.tsx"].filter((f) => { try { readFileSync(join(ROOT, f)); return true; } catch { return false; } }), vars);
const ov = await one(admin, `select public.admin_overview() as r`);
shapeCheck("admin_overview", ov, "AdminOverview", adminReads(["overview", "ov"]), { ignoreReads: NOT_GROUP });
const first = (rows) => (Array.isArray(rows[0]?.r) ? rows[0].r[0] : rows[0]?.r);
shapeCheck("admin_clubs", first(await rpc(admin, `select public.admin_clubs() as r`)), "AdminClub", adminReads(["club", "c"]), { ignoreReads: [...NOT_GROUP, "listings_count"] });
shapeCheck("admin_listings", first(await rpc(admin, `select public.admin_listings() as r`)), "AdminListing", adminReads(["listing", "l"]), { ignoreReads: NOT_GROUP });
shapeCheck("admin_brand_requests", first(await rpc(admin, `select public.admin_brand_requests() as r`)), "AdminBrandRequest", adminReads(["request", "req", "r"]), { ignoreReads: NOT_GROUP });
const rev = first(await rpc(admin, `select public.admin_revenue_by_brand() as r`));
if (rev) shapeCheck("admin_revenue_by_brand", rev, "AdminBrandRevenue"); else console.log("  INFO  admin_revenue_by_brand empty (no verified orders) - shape not checked");
shapeCheck("admin_list_admins", (await rowsOf(admin, "admin_list_admins"))[0], "AdminRosterEntry", uiReads(["src/components/admin/AdminRoster.tsx"], ["row", "entry", "admin"]), { ignoreReads: NOT_GROUP });
const ins = await one(admin, `select public.admin_insights() as r`);
shapeCheck("admin_insights", ins, "AdminInsights", new Set(), {});

summary();
