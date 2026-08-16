// Adversarial suite for the group split feature: every check here is written
// from the ATTACKER's side, so a PASS means "the attack was blocked".
//
//   npm i --no-save @electric-sql/pglite   # one time
//   node supabase/tests/split-attack.mjs
//
// These reproduce the seven gaps closed by migration 052 plus the two edge
// function fixes that shipped with it, so a future migration cannot quietly
// reopen them. Each section names the guarantee it defends:
//
//   A  order_groups is not client-writable  (052 #1: a creator could flip their
//      own group to 'paid' and release their own QR pass while others owed money)
//   B  invitations can only be declined by their recipient  (052 #3)
//   C  nothing about a group leaks to a signed-out caller  (052 #2: group_payload
//      kept the default PUBLIC grant, bypassing 051's handle-stripping)
//   D  the deadline/lifecycle rules hold  (052 #4)
//   E  payment declarations are per-member and club-scoped  (052 #6)
//   F  the rules acknowledgment is unskippable  (044)
//   G  invitations cannot be used as a mailing list  (052 #5)
import { boot, asUser, createAuthUser, check, summary } from "./harness.mjs";

const db = await boot();
console.log("Booted with all migrations\n");

const future = new Date(Date.now() + 48 * 3600e3).toISOString();
const past = new Date(Date.now() - 3600e3).toISOString();
const ACK = "test-rules-version";

/** Run fn, capture the rejection instead of throwing. */
async function attempt(fn) {
  try { return { ok: true, value: await fn() }; }
  catch (err) { return { ok: false, message: String(err.message ?? err) }; }
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
const club = await createAuthUser(db, "atkclub@cornell.edu", { club_name: "Atk Club" });
const club2 = await createAuthUser(db, "atkclub2@cornell.edu", { club_name: "Other Club" });
const alice = await createAuthUser(db, "a1@cornell.edu");
const bob = await createAuthUser(db, "b1@cornell.edu");
const carol = await createAuthUser(db, "c1@cornell.edu");
const mallory = await createAuthUser(db, "m1@cornell.edu");

await asUser(db, admin, async () => {
  for (const c of [club, club2]) {
    try { await db.query(`select public.admin_set_club_approved($1, true)`, [c.id]); }
    catch { await db.query(`update public.clubs set approved = true where id = $1`, [c.id]); }
  }
});
// Atk Club collects BOTH methods; Other Club collects neither and has splits off.
await db.query(
  `update public.clubs set venmo='atk', zelle_phone='607-555-0000', groups_enabled=true where id=$1`,
  [club.id]);
await db.query(`update public.clubs set groups_enabled=false where id=$1`, [club2.id]);
await db.query(`update public.users_extended set first_name='Alice', last_name='Nguyen' where id=$1`, [alice.id]);

async function seedListing(clubId, title, items, expires = future) {
  const { rows } = await db.query(
    `insert into public.listings (club_id, brand, title, items, contact_email, active, expires_at)
     values ($1,'Crumbl',$2,$3::jsonb,'x@cornell.edu',true,$4) returning id`,
    [clubId, title, JSON.stringify(items), expires],
  );
  return rows[0].id;
}
const listing = await seedListing(club.id, "Dozen drop", [{ name: "Dozen", price: 24, quantity: 12 }]);
const club2Listing = await seedListing(club2.id, "Closed club drop", [{ name: "Box", price: 12, quantity: 4 }]);

async function makeGroup(creator, total = 2, vis = "public", onListing = listing, item = "Dozen") {
  return asUser(db, creator, async () => {
    const { rows } = await db.query(
      `select public.create_order_group($1,$2,$3,'{}',$4,$5) as r`, [onListing, item, total, vis, ACK]);
    return rows[0].r;
  });
}
async function openTokenFor(groupId) {
  const { rows } = await db.query(
    `select invite_link_token from public.order_group_invitations
     where group_id=$1 and invited_email is null`, [groupId]);
  return rows[0].invite_link_token;
}

// ============ A. order_groups is not client-writable ============
console.log("A: direct table writes (RLS)");
{
  const gid = (await makeGroup(alice, 2)).group_id;

  const reprice = await attempt(() => asUser(db, alice, () =>
    db.query(`update public.order_groups set item_price = 0.01 where id = $1`, [gid])));
  const { rows: pr } = await db.query(`select item_price from public.order_groups where id=$1`, [gid]);
  check("creator cannot reprice their own group (the club's share figure)",
    Number(pr[0].item_price) === 24, `item_price is now ${pr[0].item_price} (write ${reprice.ok ? "succeeded" : "rejected"})`);

  const infl = await attempt(() => asUser(db, alice, () =>
    db.query(`update public.order_groups set total_people = 50 where id = $1`, [gid])));
  const { rows: tp } = await db.query(`select total_people from public.order_groups where id=$1`, [gid]);
  check("creator cannot inflate total_people to shrink their share",
    tp[0].total_people === 2, `total_people is now ${tp[0].total_people} (write ${infl.ok ? "succeeded" : "rejected"})`);

  const dl = await attempt(() => asUser(db, alice, () =>
    db.query(`update public.order_groups set order_deadline = now() + interval '30 days',
              deadline = now() + interval '30 days' where id = $1`, [gid])));
  const { rows: dr } = await db.query(
    `select order_deadline > now() + interval '20 days' as pushed from public.order_groups where id=$1`, [gid]);
  check("creator cannot push their own deadlines past automatic cancellation",
    !dr[0].pushed, `write ${dl.ok ? "succeeded" : "rejected"}`);

  const st = await attempt(() => asUser(db, alice, () =>
    db.query(`update public.order_groups set status = 'paid' where id = $1`, [gid])));
  const { rows: sr } = await db.query(`select status from public.order_groups where id=$1`, [gid]);
  check("creator cannot force their group to 'paid'",
    sr[0].status !== "paid", `status is now ${sr[0].status} (write ${st.ok ? "succeeded" : "rejected"})`);

  await db.query(`update public.order_groups set status='payment_in_progress' where id=$1`, [gid]);
  const selfPay = await attempt(() => asUser(db, alice, () =>
    db.query(`update public.order_group_members set status='paid' where group_id=$1 and user_id=$2`, [gid, alice.id])));
  const { rows: mr } = await db.query(
    `select status from public.order_group_members where group_id=$1 and user_id=$2`, [gid, alice.id]);
  check("member cannot self-verify their own share",
    mr[0].status !== "paid", `member status is ${mr[0].status} (write ${selfPay.ok ? "succeeded" : "rejected"})`);

  const sneak = await attempt(() => asUser(db, mallory, () =>
    db.query(`insert into public.order_group_members (group_id,user_id,status) values ($1,$2,'accepted')`,
      [gid, mallory.id])));
  const { rows: cnt } = await db.query(
    `select count(*)::int c from public.order_group_members where group_id=$1 and user_id=$2`, [gid, mallory.id]);
  check("outsider cannot insert themselves as a member", cnt[0].c === 0,
    `insert ${sneak.ok ? "succeeded" : "rejected"}`);

  const fab = await attempt(() => asUser(db, mallory, () =>
    db.query(`insert into public.order_groups
      (listing_id,item_name,item_price,item_quantity,split_type,total_people,filled_count,deadline,order_deadline,created_by,visibility,status)
      values ($1,'Box',0.01,4,4,4,1,now()+interval '9 days',now()+interval '9 days',$2,'public','filling')`,
      [club2Listing, mallory.id])));
  const { rows: fabRows } = await db.query(
    `select count(*)::int c from public.order_groups where listing_id=$1`, [club2Listing]);
  check("nobody can fabricate a group on a splits-disabled club's listing",
    fabRows[0].c === 0, `${fabRows[0].c} fabricated group(s) (insert ${fab.ok ? "succeeded" : "rejected"})`);
}

// A-bis. The full consequence chain the RLS hole enabled, end to end.
console.log("\nA2: pass release requires the WHOLE group to be paid");
{
  const gid = (await makeGroup(alice, 2)).group_id;
  const token = await openTokenFor(gid);
  await asUser(db, bob, () => db.query(`select public.accept_group_invite($1,$2)`, [token, ACK]));
  await asUser(db, club, () => db.query(`select public.open_group_payment($1,null)`, [gid]));
  // Exactly what the edge function writes when the club verifies ONE member.
  await db.query(
    `update public.order_group_members set status='paid', qr_encrypted='SIGNED-TOKEN', pickup_code='ABCDEFGHJK'
     where group_id=$1 and user_id=$2`, [gid, alice.id]);

  const before = await asUser(db, alice, async () => {
    const { rows } = await db.query(`select p from public.get_my_groups() p`);
    return rows.map((r) => r.p).find((p) => p.id === gid);
  });
  check("a verified member sees no pass while a co-member still owes",
    !before.my_qr && !before.my_pickup_code, `my_qr=${before.my_qr} code=${before.my_pickup_code}`);

  await attempt(() => asUser(db, alice, () =>
    db.query(`update public.order_groups set status='paid' where id=$1`, [gid])));
  const after = await asUser(db, alice, async () => {
    const { rows } = await db.query(`select p from public.get_my_groups() p`);
    return rows.map((r) => r.p).find((p) => p.id === gid);
  });
  const { rows: bobRow } = await db.query(
    `select status from public.order_group_members where group_id=$1 and user_id=$2`, [gid, bob.id]);
  check("creator cannot self-release a usable pass by flipping group status",
    !after.my_qr && !after.my_pickup_code,
    `creator holds qr=${after.my_qr} code=${after.my_pickup_code} while co-member is '${bobRow[0].status}'`);
}

// ============ B. Invitation tampering ============
console.log("\nB: invitation tampering");
{
  const gid = (await makeGroup(alice, 3, "private")).group_id;
  await asUser(db, alice, () => db.query(`select public.invite_to_group($1, $2)`, [gid, ["b1@cornell.edu"]]));
  const { rows: inv } = await db.query(
    `select invite_link_token from public.order_group_invitations
     where group_id=$1 and invited_email='b1@cornell.edu'`, [gid]);
  const token = inv[0].invite_link_token;

  const strangerDecline = await attempt(() => asUser(db, mallory, () =>
    db.query(`select public.decline_group_invite($1)`, [token])));
  const { rows: st1 } = await db.query(
    `select status from public.order_group_invitations where invite_link_token=$1`, [token]);
  check("a signed-in stranger cannot decline someone else's invitation",
    st1[0].status !== "declined", `status is ${st1[0].status} (call ${strangerDecline.ok ? "succeeded" : "rejected"})`);

  const anonDecline = await attempt(() => asUser(db, null, () =>
    db.query(`select public.decline_group_invite($1)`, [token])));
  const { rows: st2 } = await db.query(
    `select status from public.order_group_invitations where invite_link_token=$1`, [token]);
  check("a signed-OUT caller cannot decline an invitation",
    st2[0].status !== "declined", `status is ${st2[0].status} (call ${anonDecline.ok ? "succeeded" : "rejected"})`);

  const bobJoin = await attempt(() => asUser(db, bob, () =>
    db.query(`select public.accept_group_invite($1,$2) as id`, [token, ACK])));
  check("the real invitee can still accept afterwards", bobJoin.ok, bobJoin.message);

  // The recipient themselves may still decline (the feature must still work).
  await asUser(db, alice, () => db.query(`select public.invite_to_group($1,$2)`, [gid, ["c1@cornell.edu"]]));
  const { rows: cInv } = await db.query(
    `select invite_link_token from public.order_group_invitations
     where group_id=$1 and invited_email='c1@cornell.edu'`, [gid]);
  const ownDecline = await attempt(() => asUser(db, carol, () =>
    db.query(`select public.decline_group_invite($1)`, [cInv[0].invite_link_token])));
  const { rows: st3 } = await db.query(
    `select status from public.order_group_invitations where invite_link_token=$1`, [cInv[0].invite_link_token]);
  check("the invited person CAN decline their own invitation",
    ownDecline.ok && st3[0].status === "declined", `status is ${st3[0].status}`);
}

// ============ C. Signed-out exposure ============
console.log("\nC: signed-out exposure");
{
  const gid = (await makeGroup(alice, 2, "private")).group_id;
  await asUser(db, alice, () => db.query(
    `select public.set_group_member_payment($1,'venmo','@alice-secret-handle')`, [gid]));

  const anonGroups = await attempt(() => asUser(db, null, () =>
    db.query(`select count(*)::int c from public.order_groups`)));
  const seen = anonGroups.ok ? anonGroups.value.rows[0].c : 0;
  check("anon cannot enumerate group rows", seen === 0, `anon sees ${seen} row(s)`);

  const anonMembers = await attempt(() => asUser(db, null, () =>
    db.query(`select count(*)::int c from public.order_group_members`)));
  const seenM = anonMembers.ok ? anonMembers.value.rows[0].c : 0;
  check("anon cannot read member rows", seenM === 0, `anon sees ${seenM} row(s)`);

  // The 051 bypass: group_payload() carries handles and kept the default
  // PUBLIC execute grant, so anon could call it directly with any group id.
  const direct = await attempt(() => asUser(db, null, () =>
    db.query(`select public.group_payload($1) as p`, [gid])));
  check("anon cannot call group_payload() directly", !direct.ok,
    direct.ok ? `leaked ${JSON.stringify(direct.value.rows[0].p?.members)}` : "");

  // And the intended anon path (invite preview) still works AND still hides handles.
  const publicGid = (await makeGroup(bob, 2, "public")).group_id;
  await asUser(db, bob, () => db.query(
    `select public.set_group_member_payment($1,'zelle','607-555-9999')`, [publicGid]));
  const previewToken = await openTokenFor(publicGid);
  const preview = await attempt(() => asUser(db, null, async () => {
    const { rows } = await db.query(`select public.get_group_by_token($1) as p`, [previewToken]);
    return rows[0].p;
  }));
  check("the anon invite preview still resolves (feature intact)",
    preview.ok && preview.value?.item_name === "Dozen", preview.message ?? "no payload");
  const blob = JSON.stringify(preview.value ?? {});
  check("the anon invite preview leaks no payment handle",
    !blob.includes("607-555-9999") && !blob.includes("payment_handle"));
}

// ============ D. Deadline + lifecycle integrity ============
console.log("\nD: deadline + lifecycle integrity");
{
  // D1. A drop the club unpublished must stop accepting joiners.
  const deadListing = await seedListing(club.id, "Pulled drop", [{ name: "Dozen", price: 24, quantity: 12 }]);
  const gid = (await makeGroup(alice, 3, "public", deadListing)).group_id;
  const token = await openTokenFor(gid);
  await db.query(`update public.listings set active = false where id = $1`, [deadListing]);
  const joinDead = await attempt(() => asUser(db, bob, () =>
    db.query(`select public.accept_group_invite($1,$2)`, [token, ACK])));
  check("cannot join a group whose listing was unpublished", !joinDead.ok,
    "join succeeded on an inactive listing");

  // D2. Reactivating into 'filling' needs a live drop; into 'payment' does not.
  await db.query(`update public.order_groups set status='canceled' where id=$1`, [gid]);
  await db.query(`update public.listings set expires_at = $2 where id = $1`, [deadListing, past]);
  const reFill = await attempt(() => asUser(db, club, () =>
    db.query(`select public.reactivate_group($1)`, [gid])));
  check("cannot reactivate an unfilled group onto an expired/pulled drop", !reFill.ok,
    "reactivate succeeded, reopening a dead drop for joining");

  const paidListing = await seedListing(club.id, "Filled drop", [{ name: "Dozen", price: 24, quantity: 12 }]);
  const fgid = (await makeGroup(alice, 2, "public", paidListing)).group_id;
  const fToken = await openTokenFor(fgid);
  await asUser(db, bob, () => db.query(`select public.accept_group_invite($1,$2)`, [fToken, ACK]));
  await db.query(`update public.order_groups set status='canceled' where id=$1`, [fgid]);
  await db.query(`update public.listings set active=false, expires_at=$2 where id=$1`, [paidListing, past]);
  const rePay = await attempt(() => asUser(db, club, () =>
    db.query(`select public.reactivate_group($1) as r`, [fgid])));
  check("CAN still reactivate a filled group for payment on a closed drop",
    rePay.ok && rePay.value.rows[0].r.mode === "payment", rePay.message ?? "");

  // D3. Auto-cancel with someone already verified: the group cancels, the paid
  // member keeps 'paid' (they really paid), and both UIs can see it to show the
  // refund notice - but no pass is ever exposed.
  const cgid = (await makeGroup(alice, 2, "public")).group_id;
  const cToken = await openTokenFor(cgid);
  await asUser(db, bob, () => db.query(`select public.accept_group_invite($1,$2)`, [cToken, ACK]));
  await asUser(db, club, () => db.query(`select public.open_group_payment($1,null)`, [cgid]));
  await db.query(
    `update public.order_group_members set status='paid', qr_encrypted='tok', pickup_code='CANCEL0001'
     where group_id=$1 and user_id=$2`, [cgid, alice.id]);
  await db.query(`update public.order_groups set deadline = now() - interval '1 minute' where id=$1`, [cgid]);
  await db.query(`select public.process_group_deadlines()`);

  const { rows: aft } = await db.query(
    `select g.status gs, m.status ms from public.order_groups g
     join public.order_group_members m on m.group_id=g.id and m.user_id=$2 where g.id=$1`, [cgid, alice.id]);
  check("an unpaid group past its window is canceled", aft[0].gs === "canceled", `status ${aft[0].gs}`);
  check("the already-paid member stays 'paid' so a refund can be surfaced",
    aft[0].ms === "paid", `member status ${aft[0].ms}`);

  const mine = await asUser(db, alice, async () => {
    const { rows } = await db.query(`select p from public.get_my_groups() p`);
    return rows.map((r) => r.p).find((p) => p.id === cgid);
  });
  check("MyOrders can tell the paid member a refund is owed (my_status visible)",
    mine?.my_status === "paid", `my_status=${mine?.my_status}`);
  check("a canceled group exposes no pass to the paid member",
    !mine?.my_qr && !mine?.my_pickup_code, `my_qr=${mine?.my_qr} code=${mine?.my_pickup_code}`);

  const clubSees = await asUser(db, club, async () => {
    const { rows } = await db.query(`select p from public.get_club_groups() p`);
    return rows.map((r) => r.p).find((p) => p.id === cgid);
  });
  check("ClubOrders can tell the club which member it must refund",
    (clubSees?.members ?? []).some((m) => m.status === "paid"));
}

// ============ E. Payment declarations ============
console.log("\nE: payment declaration integrity");
{
  const gid = (await makeGroup(alice, 2, "public")).group_id;
  const eToken = await openTokenFor(gid);
  await asUser(db, bob, () => db.query(`select public.accept_group_invite($1,$2)`, [eToken, ACK]));

  const foreign = await attempt(() => asUser(db, mallory, () =>
    db.query(`select public.set_group_member_payment($1,'venmo','@mallory')`, [gid])));
  check("non-member cannot declare a payment method on someone else's group", !foreign.ok);

  await asUser(db, alice, () => db.query(`select public.set_group_member_payment($1,'venmo','@alice')`, [gid]));
  await asUser(db, bob, () => db.query(`select public.set_group_member_payment($1,'zelle','607-555-1111')`, [gid]));
  const tamper = await attempt(() => asUser(db, alice, () =>
    db.query(`update public.order_group_members set payment_handle='@alice-instead'
              where group_id=$1 and user_id=$2`, [gid, bob.id])));
  const { rows: bh } = await db.query(
    `select payment_handle from public.order_group_members where group_id=$1 and user_id=$2`, [gid, bob.id]);
  check("a member cannot rewrite another member's payment handle",
    bh[0].payment_handle === "607-555-1111",
    `handle is now ${bh[0].payment_handle} (write ${tamper.ok ? "succeeded" : "rejected"})`);

  const clubView = await asUser(db, club, async () => {
    const { rows } = await db.query(`select p from public.get_club_groups() p`);
    return rows.map((r) => r.p).find((p) => p.id === gid);
  });
  const handles = (clubView?.members ?? []).map((m) => m.payment_handle).filter(Boolean);
  check("the club sees both declared handles so it can match payments",
    handles.length === 2, `club sees ${handles.length}: ${handles.join(", ")}`);

  const rivalView = await asUser(db, club2, async () => {
    const { rows } = await db.query(`select p from public.get_club_groups() p`);
    return rows.map((r) => r.p).find((p) => p.id === gid);
  });
  check("a rival club cannot see this group at all", !rivalView);

  // A member must not declare a method the club does not actually collect.
  const venmoOnly = await createAuthUser(db, "venmoonly@cornell.edu", { club_name: "Venmo Only" });
  await asUser(db, admin, async () => {
    try { await db.query(`select public.admin_set_club_approved($1,true)`, [venmoOnly.id]); }
    catch { await db.query(`update public.clubs set approved=true where id=$1`, [venmoOnly.id]); }
  });
  await db.query(
    `update public.clubs set venmo='vo', zelle_phone=null, groups_enabled=true where id=$1`, [venmoOnly.id]);
  const voListing = await seedListing(venmoOnly.id, "Venmo drop", [{ name: "Dozen", price: 24, quantity: 12 }]);
  const voGid = (await makeGroup(carol, 2, "public", voListing)).group_id;
  const wrongMethod = await attempt(() => asUser(db, carol, () =>
    db.query(`select public.set_group_member_payment($1,'zelle','607-555-2222')`, [voGid])));
  check("cannot declare Zelle to a club that only collects Venmo", !wrongMethod.ok);
  const rightMethod = await attempt(() => asUser(db, carol, () =>
    db.query(`select public.set_group_member_payment($1,'venmo','@carol')`, [voGid])));
  check("CAN declare the method the club does collect", rightMethod.ok, rightMethod.message);
}

// ============ F. Acknowledgment coverage ============
console.log("\nF: disclaimer / acknowledgment coverage");
{
  const gid = (await makeGroup(alice, 2, "public")).group_id;
  const token = await openTokenFor(gid);
  const noAck = await attempt(() => asUser(db, carol, () =>
    db.query(`select public.accept_group_invite($1,null)`, [token])));
  check("joining without accepting the rules is refused", !noAck.ok);

  await asUser(db, carol, () => db.query(`select public.accept_group_invite($1,$2)`, [token, ACK]));
  const { rows: ack } = await db.query(
    `select acknowledged_at, acknowledged_rules_version from public.order_group_members
     where group_id=$1 and user_id=$2`, [gid, carol.id]);
  check("the accepted rules version is recorded per membership",
    ack[0].acknowledged_at != null && ack[0].acknowledged_rules_version === ACK);

  const { rows: unack } = await db.query(
    `select count(*)::int c from public.order_group_members where acknowledged_rules_version is null`);
  check("every membership carries an acknowledgment", unack[0].c === 0,
    `${unack[0].c} membership(s) with none`);

  await asUser(db, club, () => db.query(`select public.set_club_groups_enabled(false, null)`));
  const reEnableNoAck = await attempt(() => asUser(db, club, () =>
    db.query(`select public.set_club_groups_enabled(true, null)`)));
  check("re-enabling splits requires a fresh acknowledgment", !reEnableNoAck.ok);
  await asUser(db, club, () => db.query(`select public.set_club_groups_enabled(true, $1)`, [ACK]));
}

// ============ G. Invitation fan-out ============
console.log("\nG: invitation fan-out");
{
  const gid = (await makeGroup(alice, 3, "private")).group_id;
  const many = Array.from({ length: 500 }, (_, i) => `spam${i}@cornell.edu`);
  const blast = await attempt(() => asUser(db, alice, () =>
    db.query(`select public.invite_to_group($1,$2)`, [gid, many])));
  const { rows: c1 } = await db.query(
    `select count(*)::int c from public.order_group_invitations where group_id=$1 and invited_email is not null`, [gid]);
  check("a 500-address blast is refused outright", !blast.ok, `${c1[0].c} invitation row(s) created`);

  // Repeated smaller batches must not add up past the per-group ceiling either.
  for (let batch = 0; batch < 6; batch += 1) {
    await attempt(() => asUser(db, alice, () => db.query(
      `select public.invite_to_group($1,$2)`,
      [gid, Array.from({ length: 20 }, (_, i) => `drip${batch}-${i}@cornell.edu`)])));
  }
  const { rows: c2 } = await db.query(
    `select count(*)::int c from public.order_group_invitations where group_id=$1 and invited_email is not null`, [gid]);
  check("drip-fed batches cannot exceed the per-group invitation ceiling",
    c2[0].c <= 20, `${c2[0].c} invitation rows on a 3-person group`);

  // The ordinary case still works.
  const okGid = (await makeGroup(bob, 3, "private")).group_id;
  const normal = await attempt(() => asUser(db, bob, () =>
    db.query(`select public.invite_to_group($1,$2)`, [okGid, ["x1@cornell.edu", "x2@cornell.edu"]])));
  const { rows: c3 } = await db.query(
    `select count(*)::int c from public.order_group_invitations where group_id=$1 and invited_email is not null`, [okGid]);
  check("inviting a couple of friends still works", normal.ok && c3[0].c === 2, `${c3[0].c} rows`);
}

// ============ H. Automation health ============
console.log("\nH: deadline automation health");
{
  const health = await attempt(() => asUser(db, club, async () => {
    const { rows } = await db.query(`select public.split_automation_health() as h`);
    return rows[0].h;
  }));
  check("a club can check whether the deadline job is scheduled",
    health.ok && typeof health.value?.cron_scheduled === "boolean", health.message ?? "");
  const studentCheck = await attempt(() => asUser(db, alice, () =>
    db.query(`select public.split_automation_health()`)));
  check("a student cannot read platform automation health", !studentCheck.ok);
  if (health.ok) console.log(`  INFO  ${JSON.stringify(health.value)}`);
}

summary();
