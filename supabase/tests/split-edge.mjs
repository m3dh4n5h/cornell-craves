// Edge-case suite for the group split (order splitting) feature.
// Runs every migration on in-memory Postgres, then drives the split flow the
// way OrderForm.tsx / MyOrders.tsx / ClubOrders.tsx / InvitePage.tsx do:
// creation guards, join races, per-member payment declarations (043), QR and
// pickup-code gating (043), the recommender, and public-group matching.
//
//   npm i --no-save @electric-sql/pglite   # one time
//   node supabase/tests/split-edge.mjs
//
// These checks also guard the regression fixed in 043: migration 021 rewrote
// create_order_group / join_or_create_public_group for visibility and dropped
// 009's guarantees (divisor-only splits, groups_enabled, item_quantity
// snapshot, splits above 4 people).
import { boot, asUser, createAuthUser, check, summary } from "./harness.mjs";

const db = await boot();
console.log("Booted with all migrations\n");

const future = new Date(Date.now() + 48 * 3600e3).toISOString();
const past = new Date(Date.now() - 3600e3).toISOString();

/** Run fn, capture the rejection instead of throwing. */
async function attempt(fn) {
  try {
    return { ok: true, value: await fn() };
  } catch (err) {
    return { ok: false, message: String(err.message ?? err) };
  }
}

// ---- Actors ----
const ADMIN_EMAIL = process.env.ADMIN_EMAIL ?? "admin@cornell.edu";
await db.exec(`
  do $$ begin
    if to_regclass('public.admin_emails') is not null then
      insert into public.admin_emails (email) values ('${ADMIN_EMAIL}') on conflict do nothing;
    end if;
  end $$;
`);
const admin = await createAuthUser(db, ADMIN_EMAIL);
const clubUser = await createAuthUser(db, "splitclub@cornell.edu", { club_name: "Split Club" });
const noGroupsClub = await createAuthUser(db, "nogroups@cornell.edu", { club_name: "No Groups Club" });
const alice = await createAuthUser(db, "alice7@cornell.edu");
const bob = await createAuthUser(db, "bob7@cornell.edu");
const charlie = await createAuthUser(db, "charlie7@cornell.edu");
const dana = await createAuthUser(db, "dana7@cornell.edu");
const outsider = await createAuthUser(db, "rando@gmail.com"); // not Cornell

// Clubs rows exist via the signup trigger; the approved flag is admin-guarded.
await asUser(db, admin, async () => {
  for (const c of [clubUser, noGroupsClub]) {
    try {
      await db.query(`select public.admin_set_club_approved($1, true)`, [c.id]);
    } catch {
      await db.query(`update public.clubs set approved = true where id = $1`, [c.id]);
    }
  }
});
await db.query(
  `update public.clubs set venmo = 'split-club', zelle_phone = '607-555-0134',
   member_options = '{Aarav,Maya}', groups_enabled = true where id = $1`,
  [clubUser.id],
);
await db.query(`update public.clubs set groups_enabled = false where id = $1`, [noGroupsClub.id]);

// Listings (inserted as service role; brand gating is covered by simulate.mjs).
async function seedListing(clubId, title, items, extra = {}) {
  const { rows } = await db.query(
    `insert into public.listings (club_id, brand, title, items, contact_email, active, expires_at, recommender_enabled)
     values ($1, 'Crumbl', $2, $3::jsonb, 'x@cornell.edu', true, $4, $5) returning id`,
    [clubId, title, JSON.stringify(items), extra.expires ?? future, extra.recommender ?? false],
  );
  return rows[0].id;
}

const mainListing = await seedListing(
  clubUser.id,
  "Dozen drop",
  [
    { name: "Dozen", price: 24, quantity: 12 },
    { name: "Single", price: 5, quantity: 1 },
    { name: "Sixpack", price: 12, quantity: 6 },
  ],
  { recommender: true },
);
const noRecListing = await seedListing(clubUser.id, "No recommender drop", [
  { name: "Dozen", price: 24, quantity: 12 },
]);
const expiredListing = await seedListing(
  clubUser.id,
  "Expired drop",
  [{ name: "Dozen", price: 24, quantity: 12 }],
  { expires: past },
);
const noGroupsListing = await seedListing(noGroupsClub.id, "Groups off drop", [
  { name: "Dozen", price: 24, quantity: 12 },
]);

const createGroup = (user, listingId, item, ways, emails = [], visibility = "public") =>
  asUser(db, user, async () => {
    const { rows } = await db.query(
      `select public.create_order_group($1, $2, $3, $4, $5) as res`,
      [listingId, item, ways, emails, visibility],
    );
    return rows[0].res;
  });

const groupRow = async (id) =>
  (await db.query(`select * from public.order_groups where id = $1`, [id])).rows[0];
const membersOf = async (id) =>
  (await db.query(`select * from public.order_group_members where group_id = $1 order by created_at`, [id])).rows;
const payload = async (id) =>
  (await db.query(`select public.group_payload($1) as p`, [id])).rows[0].p;

// =====================================================================
console.log("S1: creation guards");

let r = await attempt(() => asUser(db, null, () => db.query(`select public.create_order_group($1,'Dozen',2,'{}','public')`, [mainListing])));
check("anonymous caller cannot create a group", !r.ok);

r = await attempt(() => createGroup(alice, mainListing, "Dozen", 5));
check("non-divisor split rejected (12-box, 5 ways)", !r.ok, r.ok ? "was accepted" : "");

r = await attempt(() => createGroup(alice, mainListing, "Single", 2));
check("quantity-1 item cannot be split", !r.ok, r.ok ? "was accepted" : "");

r = await attempt(() => createGroup(alice, mainListing, "Dozen", 1));
check("1-way split rejected", !r.ok);

r = await attempt(() => createGroup(alice, mainListing, "Nonexistent", 2));
check("unknown item rejected", !r.ok);

r = await attempt(() => createGroup(alice, expiredListing, "Dozen", 2));
check("expired listing rejected", !r.ok);

r = await attempt(() => createGroup(alice, mainListing, "Dozen", 2, [], "friends-only"));
check("invalid visibility rejected", !r.ok);

r = await attempt(() => createGroup(alice, noGroupsListing, "Dozen", 2));
check("club with groups disabled rejected", !r.ok, r.ok ? "was accepted" : "");

// The UI offers every divisor of the box (SplitTypeSelector): 12 -> 2,3,4,6,12.
r = await attempt(() => createGroup(alice, mainListing, "Dozen", 6));
check("6-way split of a dozen allowed (UI offers it)", r.ok, r.ok ? "" : r.message);
if (r.ok) {
  const g = await groupRow(r.value.group_id);
  check("item_quantity snapshotted on the group (12)", Number(g.item_quantity) === 12, `got ${g.item_quantity}`);
  const p = await payload(r.value.group_id);
  check("units_per_person derived correctly (12/6 = 2)", Number(p.units_per_person) === 2, `got ${p.units_per_person}`);
}

r = await attempt(() => createGroup(alice, mainListing, "Dozen", 2, [], "private"));
check("private group creates with NO open share link", r.ok && r.value.open_token == null, r.ok ? `token: ${r.value.open_token}` : r.message);
const privateGroupId = r.ok ? r.value.group_id : null;

// =====================================================================
console.log("\nS2: joining, filling, invitations");

const pub = await createGroup(bob, mainListing, "Sixpack", 2, [], "public");
const pubToken = pub.open_token;

r = await attempt(() => asUser(db, outsider, () => db.query(`select public.accept_group_invite($1)`, [pubToken])));
check("non-Cornell account cannot join a split (023 trigger)", !r.ok);

r = await attempt(() => asUser(db, bob, () => db.query(`select public.accept_group_invite($1)`, [pubToken])));
check("creator re-joining own group is idempotent", r.ok && (await membersOf(pub.group_id)).length === 1);

await asUser(db, charlie, () => db.query(`select public.accept_group_invite($1)`, [pubToken]));
let g = await groupRow(pub.group_id);
let ms = await membersOf(pub.group_id);
check("group fills -> status full", g.status === "full");
check("all members flip to pending_payment on fill", ms.every((m) => m.status === "pending_payment"));
const deadlineMs = new Date(g.deadline).getTime() - Date.now();
check("payment deadline reset to ~24h on fill", deadlineMs > 23 * 3600e3 && deadlineMs < 25 * 3600e3);

r = await attempt(() => asUser(db, dana, () => db.query(`select public.accept_group_invite($1)`, [pubToken])));
check("joining a FULL group rejected", !r.ok);

// Private-group personal invite: invite dana, she declines, link dies.
await asUser(db, alice, () => db.query(`select public.invite_to_group($1, $2)`, [privateGroupId, ["dana7@cornell.edu"]]));
const inviteToken = (
  await db.query(`select invite_link_token from public.order_group_invitations where group_id = $1 and invited_email = 'dana7@cornell.edu'`, [privateGroupId])
).rows[0].invite_link_token;
await asUser(db, dana, () => db.query(`select public.decline_group_invite($1)`, [inviteToken]));
r = await attempt(() => asUser(db, dana, () => db.query(`select public.accept_group_invite($1)`, [inviteToken])));
check("declined invite link cannot be accepted", !r.ok);

r = await attempt(() => asUser(db, charlie, () => db.query(`select public.invite_to_group($1, $2)`, [pub.group_id, ["dana7@cornell.edu"]])));
check("cannot invite to a group that is no longer filling", !r.ok);

r = await attempt(() => asUser(db, dana, () => db.query(`select public.invite_to_group($1, $2)`, [privateGroupId, ["bob7@cornell.edu"]])));
check("non-member cannot invite others", !r.ok);

// =====================================================================
console.log("\nS3: per-member payment declarations (043)");

r = await attempt(() => asUser(db, dana, () => db.query(`select public.set_group_member_payment($1,'venmo','dana-pays')`, [pub.group_id])));
check("non-member cannot declare payment", !r.ok);

r = await attempt(() => asUser(db, bob, () => db.query(`select public.set_group_member_payment($1,'cashapp','bob')`, [pub.group_id])));
check("invalid method rejected", !r.ok);

r = await attempt(() => asUser(db, bob, () => db.query(`select public.set_group_member_payment($1,'venmo','   ')`, [pub.group_id])));
check("blank handle rejected", !r.ok);

await asUser(db, bob, () => db.query(`select public.set_group_member_payment($1,'venmo','bob-venmo')`, [pub.group_id]));
await asUser(db, bob, () => db.query(`select public.set_group_member_payment($1,'zelle','bob7@cornell.edu')`, [pub.group_id]));
let p = await payload(pub.group_id);
let bobM = p.members.find((m) => m.user_id === bob.id);
check("member can change method while unpaid (venmo -> zelle)", bobM?.payment_method === "zelle" && bobM?.payment_handle === "bob7@cornell.edu");
check("club-visible payload carries method + handle", p.members.some((m) => m.payment_method === "zelle"));

// Verify bob (what the edge function does per member).
await db.query(`update public.order_group_members set status='paid', qr_encrypted='tok-bob', pickup_code='ABCDEFGH12' where group_id=$1 and user_id=$2`, [pub.group_id, bob.id]);
await db.query(`update public.order_groups set status='payment_in_progress' where id=$1`, [pub.group_id]);
r = await attempt(() => asUser(db, bob, () => db.query(`select public.set_group_member_payment($1,'venmo','sneaky-swap')`, [pub.group_id])));
check("payment details locked after the club verifies the member", !r.ok);

// =====================================================================
console.log("\nS4: QR pass + pickup-code gating (043)");

let mine = await asUser(db, bob, async () => (await db.query(`select * from public.get_my_groups()`)).rows.map((x) => x.get_my_groups));
let mg = mine.find((x) => x.id === pub.group_id);
check("verified member's QR hidden while others unpaid", mg.my_qr === "");
check("verified member's pickup code hidden while others unpaid", mg.my_pickup_code == null);

// Charlie pays too -> whole group verified.
await db.query(`update public.order_group_members set status='paid', qr_encrypted='tok-charlie', pickup_code='JKMNPQRS34' where group_id=$1 and user_id=$2`, [pub.group_id, charlie.id]);
await db.query(`update public.order_groups set status='paid' where id=$1`, [pub.group_id]);
mine = await asUser(db, bob, async () => (await db.query(`select * from public.get_my_groups()`)).rows.map((x) => x.get_my_groups));
mg = mine.find((x) => x.id === pub.group_id);
check("QR unlocks once the WHOLE group is verified", mg.my_qr === "tok-bob");
check("10-char pickup code unlocks with it", mg.my_pickup_code === "ABCDEFGH12");
check("member only ever sees their OWN token", JSON.stringify(mg).includes("tok-charlie") === false);

// Token page (public, pre-auth) must never leak passes or codes.
const anonView = await asUser(db, null, async () =>
  (await db.query(`select public.get_group_by_token($1) as p`, [pubToken])).rows[0].p,
);
const leaked = JSON.stringify(anonView);
check("anon token payload leaks no QR tokens", !leaked.includes("tok-bob") && !leaked.includes("qr_encrypted"));
check("anon token payload leaks no pickup codes", !leaked.includes("ABCDEFGH12") && !leaked.includes("pickup_code"));

// Canceled group hides everything again.
await db.query(`update public.order_groups set status='canceled' where id=$1`, [pub.group_id]);
mine = await asUser(db, bob, async () => (await db.query(`select * from public.get_my_groups()`)).rows.map((x) => x.get_my_groups));
mg = mine.find((x) => x.id === pub.group_id);
check("canceled group hides QR + code", mg.my_qr === "" && mg.my_pickup_code == null);
r = await attempt(() => asUser(db, charlie, () => db.query(`select public.set_group_member_payment($1,'venmo','x')`, [pub.group_id])));
check("canceled group refuses payment updates", !r.ok);
await db.query(`update public.order_groups set status='paid' where id=$1`, [pub.group_id]); // restore

// =====================================================================
console.log("\nS5: recommender on splits (043)");

r = await attempt(() => asUser(db, alice, () => db.query(`select public.set_group_recommender($1,'Aarav')`, [privateGroupId])));
check("creator sets a listed recommender", r.ok, r.ok ? "" : r.message);
check("recommended_by lands on the group", (await groupRow(privateGroupId)).recommended_by === "Aarav");

r = await attempt(() => asUser(db, bob, () => db.query(`select public.set_group_recommender($1,'Maya')`, [privateGroupId])));
check("non-creator cannot set the recommender", !r.ok);

r = await attempt(() => asUser(db, alice, () => db.query(`select public.set_group_recommender($1,'Zed')`, [privateGroupId])));
check("name off the club's list rejected", !r.ok);

await asUser(db, alice, () => db.query(`select public.set_group_recommender($1,'')`, [privateGroupId]));
check("blank clears the recommender", (await groupRow(privateGroupId)).recommended_by == null);

const noRec = await createGroup(alice, noRecListing, "Dozen", 2, [], "public");
r = await attempt(() => asUser(db, alice, () => db.query(`select public.set_group_recommender($1,'Aarav')`, [noRec.group_id])));
check("listing without recommender enabled rejects it", !r.ok);

// =====================================================================
console.log("\nS6: public-group matching (join_or_create_public_group)");

const joinPublic = (user, listingId, item, ways) =>
  asUser(db, user, async () => {
    const { rows } = await db.query(`select public.join_or_create_public_group($1,$2,$3) as res`, [listingId, item, ways]);
    return rows[0].res;
  });

const s1 = await joinPublic(alice, mainListing, "Dozen", 3);
check("solo with no open group creates one", s1.joined === false && s1.open_token != null);
check("solo-created group snapshots item_quantity", Number((await groupRow(s1.group_id)).item_quantity) === 12, `got ${(await groupRow(s1.group_id)).item_quantity}`);

const s2 = await joinPublic(bob, mainListing, "Dozen", 3);
check("next solo joins the earliest matching group", s2.joined === true && s2.group_id === s1.group_id);

const s3 = await joinPublic(charlie, mainListing, "Dozen", 4);
check("different split size does NOT match", s3.joined === false && s3.group_id !== s1.group_id);

const s4 = await joinPublic(alice, mainListing, "Dozen", 3);
check("solo never re-joins a group they are in", s4.group_id !== s1.group_id);

const s5 = await joinPublic(dana, mainListing, "Dozen", 3);
check("third member fills the 3-way group", s5.joined === true && (await groupRow(s1.group_id)).status === "full");

r = await attempt(() => joinPublic(dana, mainListing, "Dozen", 5));
check("solo path also rejects non-divisor sizes", !r.ok, r.ok ? "was accepted" : "");

r = await attempt(() => joinPublic(dana, mainListing, "Sixpack", 6));
check("solo path allows any divisor the UI offers (6-way)", r.ok, r.ok ? "" : r.message);

r = await attempt(() => joinPublic(dana, noGroupsListing, "Dozen", 2));
check("solo path respects the club's groups toggle", !r.ok, r.ok ? "was accepted" : "");

summary();
