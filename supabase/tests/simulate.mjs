// Simulate the brand-approval workflow exactly as the frontend drives it.
// Each step mirrors a real client call (same columns, same RPCs).
import { boot, asUser, createAuthUser, check, summary } from "./harness.mjs";

const ADMIN_EMAIL = "medhansh.bhagchandani@gmail.com";
// Post-040 expectations by default; FIXED=0 replays the pre-040 bugs (boot
// the harness with { through: "039" } to see them).
const FIXED = process.env.FIXED !== "0";

const db = await boot();
console.log(`Booted with migrations${FIXED ? " (including 040 fix)" : " through 039"}\n`);

// ---- Actors ----
const admin = await createAuthUser(db, ADMIN_EMAIL);
const clubA = await createAuthUser(db, "clubA@cornell.edu", { club_name: "Club A" });
const clubB = await createAuthUser(db, "clubB@cornell.edu", { club_name: "Club B" });
const student = await createAuthUser(db, "stu1@cornell.edu");
// Admin approves both clubs (Admin.tsx approveClub -> rpc admin_set_club_approved,
// which only exists if 035 ran; fall back to direct update as definer).
await asUser(db, admin, async () => {
  for (const c of [clubA, clubB]) {
    try {
      await db.query(`select public.admin_set_club_approved($1, true)`, [c.id]);
    } catch {
      await db.query(`update public.clubs set approved = true where id = $1`, [c.id]);
    }
  }
});

const future = new Date(Date.now() + 48 * 3600e3).toISOString();
const past = new Date(Date.now() - 3600e3).toISOString();

// Frontend "new listing" insert (Dashboard.tsx handleSubmit)
async function saveListing(user, { brand, mode, title, expires = future }) {
  return asUser(db, user, async () => {
    const { rows } = await db.query(
      `insert into public.listings (club_id, brand, title, items, contact_email, active, draft, auto_post_on_brand, expires_at)
       values ($1, $2, $3, '[{"name":"Box","price":10}]'::jsonb, 'x@cornell.edu', $4, $5, $6, $7)
       returning id`,
      [user.id, brand, title, mode === "publish", mode === "draft", mode === "autopost", expires],
    );
    if (mode !== "publish") {
      await db.query(`select public.request_brand($1)`, [brand]); // fire-and-forget in UI
    }
    return rows[0].id;
  });
}

const listing = async (id) =>
  (await db.query(`select * from public.listings where id = $1`, [id])).rows[0];

const pendingRequests = async () =>
  asUser(db, admin, async () => (await db.query(`select public.admin_brand_requests() as r`)).rows.map((x) => x.r));

async function decide(requestId, name, action) {
  return asUser(db, admin, () =>
    db.query(`select public.decide_brand_request($1, $2, $3)`, [requestId, name, action]));
}

console.log("S1: autopost draft -> admin 'Approve once' -> should go live");
const l1 = await saveListing(clubA, { brand: "Levain Bakery", mode: "autopost", title: "Levain drop 1" });
let reqs = await pendingRequests();
check("brand request is pending in admin queue", reqs.length === 1);
await decide(reqs[0].id, "Levain Bakery", "one_time");
let row = await listing(l1);
check("listing published after approve-once", row.active && !row.draft && !row.auto_post_on_brand);
check("approved_brand recorded", row.approved_brand === "Levain Bakery");

console.log("\nS2: SAME club posts the SAME brand again later (the long-running bug)");
const l2 = await saveListing(clubA, { brand: "Levain Bakery", mode: "autopost", title: "Levain drop 2" });
reqs = await pendingRequests();
row = await listing(l2);
if (!FIXED) {
  check("BUG REPRODUCED: no pending request created (deduped against old approved one)", reqs.length === 0);
  check("BUG REPRODUCED: listing stuck unpublished forever", !row.active);
} else {
  check("second listing publishes instantly (club already approved for brand)", row.active && !row.draft, JSON.stringify(row));
  check("no redundant admin request", reqs.length === 0);
}

console.log("\nS3: draft flow -> approve once -> club posts manually");
const l3 = await saveListing(clubA, { brand: "Magnolia", mode: "draft", title: "Magnolia draft" });
reqs = await pendingRequests();
check("draft files a pending request", reqs.length === 1);
await decide(reqs[0].id, "Magnolia", "one_time");
row = await listing(l3);
check("draft stays a draft after approval", row.draft && !row.active);
check("draft records approved brand", row.approved_brand === "Magnolia");
// Club clicks "Post now" (Dashboard publishDraft)
await asUser(db, clubA, () =>
  db.query(`update public.listings set active = true, draft = false, auto_post_on_brand = false where id = $1`, [l3]));
row = await listing(l3);
check("club can post the approved draft", row.active && !row.draft);

console.log("\nS4: enforcement — a club publishes an UNapproved brand directly (template path / hostile client)");
let blocked = false;
let l4 = null;
try {
  l4 = await saveListing(clubB, { brand: "Totally Fake Brand", mode: "publish", title: "Sneaky drop" });
} catch (err) {
  blocked = true;
}
if (!FIXED) {
  check("BUG REPRODUCED: unapproved brand went straight to the live feed", !blocked && (await listing(l4)).active);
} else {
  check("DB blocks publishing an unapproved brand", blocked);
}

console.log("\nS4b: club B may NOT piggyback on club A's one-time approval");
let blockedB = false;
try {
  const lx = await saveListing(clubB, { brand: "Levain Bakery", mode: "publish", title: "B steals Levain" });
  blockedB = !(await listing(lx)).active;
} catch { blockedB = true; }
if (FIXED) check("one-time approval is scoped to the requesting club", blockedB);
else console.log(`  (pre-fix: piggyback allowed = ${!blockedB} — no enforcement at all)`);

console.log("\nS5: 'Deploy to all' publishes every club's waiting autopost listings");
const l5a = await saveListing(clubA, { brand: "Van Leeuwen", mode: "autopost", title: "A ice cream" });
const l5b = await saveListing(clubB, { brand: "Van Leeuwen", mode: "autopost", title: "B ice cream" });
reqs = await pendingRequests();
const vl = reqs.find((r) => r.requested_name === "Van Leeuwen");
check("one pending request per club+brand", reqs.filter((r) => r.requested_name === "Van Leeuwen").length === 2);
await decide(vl.id, "Van Leeuwen", "global");
check("club A autopost went live", (await listing(l5a)).active);
check("club B autopost went live (global trigger)", (await listing(l5b)).active);
const brandRow = await db.query(`select 1 from public.brands where name = 'Van Leeuwen'`);
check("brand added to the global list", brandRow.rows.length === 1);

console.log("\nS6: reject, then club can re-request");
const l6 = await saveListing(clubB, { brand: "Halal Guys", mode: "draft", title: "Halal draft" });
reqs = await pendingRequests();
const hg = reqs.find((r) => r.requested_name === "Halal Guys");
await decide(hg.id, "Halal Guys", "reject");
await asUser(db, clubB, () => db.query(`select public.request_brand('Halal Guys')`));
reqs = await pendingRequests();
check("club can file a fresh request after rejection", reqs.some((r) => r.requested_name === "Halal Guys"));

console.log("\nS7: autopost listing that EXPIRED while waiting for approval");
const l7 = await saveListing(clubA, { brand: "Milk Bar", mode: "autopost", title: "Expired drop", expires: past });
reqs = await pendingRequests();
const mb = reqs.find((r) => r.requested_name === "Milk Bar");
await decide(mb.id, "Milk Bar", "one_time");
row = await listing(l7);
if (!FIXED) {
  check("BUG REPRODUCED: expired listing 'published' into the void", row.active, JSON.stringify({ active: row.active }));
} else {
  check("expired autopost becomes a postable draft instead of publishing", !row.active && row.draft && row.approved_brand === "Milk Bar", JSON.stringify(row));
}

console.log("\nS8: student/anon cannot call admin or club RPCs");
let denied = 0;
await asUser(db, student, async () => {
  try { await db.query(`select public.decide_brand_request(gen_random_uuid(), 'X', 'global')`); } catch { denied += 1; }
  try { await db.query(`select public.request_brand('X')`); } catch { denied += 1; }
});
check("student blocked from decide_brand_request and request_brand", denied === 2);

if (FIXED) {
  console.log("\nS9 (fix only): request_brand while already approved-for-club files nothing new");
  await asUser(db, clubA, () => db.query(`select public.request_brand('Levain Bakery')`));
  reqs = await pendingRequests();
  check("no pending request for an already-approved brand", !reqs.some((r) => r.requested_name === "Levain Bakery"));

  console.log("\nS10 (fix only): admin can revoke a one-time approval and enforcement kicks back in");
  await asUser(db, admin, async () => {
    const { rows } = await db.query(`select public.admin_club_brand_approvals() as r`);
    const grant = rows.map((x) => x.r).find((g) => g.brand === "Levain Bakery");
    await db.query(`select public.admin_revoke_club_brand($1)`, [grant.id]);
  });
  let blockedAfterRevoke = false;
  try {
    await saveListing(clubA, { brand: "Levain Bakery", mode: "publish", title: "post-revoke" });
  } catch { blockedAfterRevoke = true; }
  check("publishing blocked after revoke", blockedAfterRevoke);
  check("existing live listings survive a revoke", (await listing(l1)).active);

  console.log("\nS11 (fix only): admin moderation — hide a live listing");
  await asUser(db, admin, () => db.query(`select public.admin_set_listing_active($1, false)`, [l1]));
  check("admin can deactivate any listing", !(await listing(l1)).active);
  let studentDenied = false;
  await asUser(db, student, async () => {
    try { await db.query(`select public.admin_set_listing_active($1, true)`, [l1]); } catch { studentDenied = true; }
  });
  check("non-admin cannot use moderation RPC", studentDenied);

  console.log("\nS13 (fix only): admin renames a misspelled brand at approval time");
  const l13 = await saveListing(clubB, { brand: "krispy kream", mode: "autopost", title: "typo drop" });
  reqs = await pendingRequests();
  const kk = reqs.find((r) => r.requested_name === "krispy kream");
  check("held-listings count rides on the request", kk && Number(kk.held_listings) === 1, JSON.stringify(kk));
  await decide(kk.id, "Krispy Kremeo", "one_time"); // admin fixes spelling (to a non-global name)
  row = await listing(l13);
  check("listing renamed + published under the approved name", row.active && row.brand === "Krispy Kremeo");
  const grant13 = await db.query(
    `select 1 from public.club_brand_approvals where club_id = $1 and lower(brand) = lower('Krispy Kremeo')`,
    [clubB.id],
  );
  check("durable approval stored under the corrected name", grant13.rows.length === 1);

  console.log("\nS14 (fix only): suspended club's next publish attempt");
  await asUser(db, admin, () => db.query(`select public.admin_set_club_approved($1, false)`, [clubB.id]));
  let suspendedBlocked = false;
  try {
    await saveListing(clubB, { brand: "Krispy Kremeo", mode: "publish", title: "while suspended" });
  } catch { suspendedBlocked = true; }
  check("suspended club cannot insert listings (RLS)", suspendedBlocked);
  await asUser(db, admin, () => db.query(`select public.admin_set_club_approved($1, true)`, [clubB.id]));

  console.log("\nS12 (fix only): club dashboard stats RPC");
  await asUser(db, clubA, async () => {
    const { rows } = await db.query(`select public.club_dashboard_stats() as s`);
    const s = rows[0].s;
    check("stats RPC returns live/draft/order counts", s && typeof s.live_drops === "number" && typeof s.pending_brands === "number", JSON.stringify(s));
  });
}

summary();
