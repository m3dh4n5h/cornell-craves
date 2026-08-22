// End-to-end lifecycle suite for split orders: every path a group can take from
// creation to pickup (or to cancellation), asserting BOTH the database action
// and the email that action is supposed to trigger.
//
//   npm i --no-save @electric-sql/pglite   # one time
//   node supabase/tests/split-lifecycle.mjs
//
// Why this exists alongside split-edge.mjs and split-attack.mjs: those cover
// guards ("can this be done?") and attacks ("is this blocked?"). Neither walks a
// group all the way through, and neither checks the notification side at all -
// yet the rules students agree to (SPLIT_RULES in src/lib/groups.ts) are almost
// entirely promises about *when they will be told something*: "we will email
// you", "you will have 24 hours", "you will get another email with a fresh
// deadline". A silent transition is a broken promise even when every row is
// correct.
//
// ---------------------------------------------------------------------------
// How emails are asserted without deploying the edge function
// ---------------------------------------------------------------------------
// In production nothing in SQL sends mail. Two Supabase Database Webhooks do:
//
//   order_groups            UPDATE -> notify-cravings -> handleGroupStatusChange(record, old_record.status)
//   order_group_invitations INSERT -> notify-cravings -> emailGroupInvite(record)
//
// and one club action does: verifyGroupPayment() in the same function, which
// emails passes once the LAST member is verified.
//
// So the test installs triggers at exactly those two points, recording what the
// webhook would have been handed. `emailsForGroupUpdate()` below is a
// line-by-line mirror of handleGroupStatusChange's branch table, and turns those
// records into the emails that would go out; `drainMail()` returns them for
// assertion.
//
// A mirror can drift from the thing it mirrors, so S1 reads
// supabase/functions/notify-cravings/index.ts and fails if a branch the mirror
// claims exists is no longer in the function. And S13 fails if the run produced
// any status transition the mirror does not account for - which is how a future
// migration that adds a new group state gets caught shipping silence.
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { boot, asUser, createAuthUser, check, summary } from "./harness.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const EDGE_FN = join(HERE, "..", "functions", "notify-cravings", "index.ts");
const RULES_FILE = join(HERE, "..", "..", "src", "lib", "groups.ts");
const CSV_FILE = join(HERE, "..", "..", "src", "lib", "orderCsv.ts");

const db = await boot();
console.log("Booted with all migrations\n");

const future = new Date(Date.now() + 96 * 3600e3).toISOString();
const ACK = "test-rules-v1";

async function attempt(fn) {
  try {
    return { ok: true, value: await fn() };
  } catch (err) {
    return { ok: false, message: String(err.message ?? err) };
  }
}

// ===========================================================================
// Webhook capture: the two triggers Supabase fires notify-cravings from.
// ===========================================================================
await db.exec(`
  create table public._webhook_log (
    seq bigserial primary key,
    table_name text not null,
    op text not null,
    record jsonb not null,
    old_record jsonb
  );

  -- Mirrors the "order_groups UPDATE" database webhook. Fires on EVERY update,
  -- exactly like the real one - the decision to stay silent when the status did
  -- not change is the edge function's, not the database's, and the test has to
  -- see the same raw stream in order to prove that.
  create or replace function public._log_group_update() returns trigger
  language plpgsql as $$
  begin
    insert into public._webhook_log (table_name, op, record, old_record)
    values ('order_groups', 'UPDATE', to_jsonb(new), to_jsonb(old));
    return new;
  end $$;
  create trigger _log_group_update after update on public.order_groups
    for each row execute function public._log_group_update();

  -- Mirrors the "order_group_invitations INSERT" webhook.
  create or replace function public._log_invite_insert() returns trigger
  language plpgsql as $$
  begin
    insert into public._webhook_log (table_name, op, record, old_record)
    values ('order_group_invitations', 'INSERT', to_jsonb(new), null);
    return new;
  end $$;
  create trigger _log_invite_insert after insert on public.order_group_invitations
    for each row execute function public._log_invite_insert();
`);

/**
 * Mirror of groupMemberEmails() in the edge function: profile cornell_email,
 * falling back to the auth address, and members with neither are skipped.
 */
async function recipientsOf(groupId) {
  const { rows } = await db.query(
    `select m.user_id,
            coalesce(nullif(u.cornell_email, ''), au.email, '') as email,
            m.status
     from public.order_group_members m
     left join public.users_extended u on u.id = m.user_id
     left join auth.users au on au.id = m.user_id
     where m.group_id = $1
     order by m.created_at`,
    [groupId],
  );
  return rows.filter((r) => r.email);
}

/**
 * Line-by-line mirror of handleGroupStatusChange() in
 * supabase/functions/notify-cravings/index.ts. Returns the emails that webhook
 * call would send. `null` transitions (returns 0) produce [].
 */
async function emailsForGroupUpdate(record, oldRecord) {
  const status = record.status;
  const previous = oldRecord?.status ?? "";
  if (status === previous) return []; // first line of the real handler

  const everyone = await recipientsOf(record.id);

  if (status === "full") {
    return everyone.map((m) => ({ to: m.email, subject: "Your split order is full" }));
  }
  if (status === "payment_in_progress" && previous === "full") {
    return everyone.map((m) => ({ to: m.email, subject: "Time to pay your split share" }));
  }
  if (status === "filling" && previous === "canceled") {
    return everyone.map((m) => ({ to: m.email, subject: "Your split order is open again" }));
  }
  if (status === "canceled") {
    // Two variants: whoever the club already verified sent real money that the
    // club must hand back; everyone else was never charged.
    const reason = previous === "filling" ? "did not fill in time" : "before everyone paid";
    return everyone.map((m) => ({
      to: m.email,
      subject: "Your split order was canceled",
      variant: m.status === "paid" ? "refund_owed" : "not_charged",
      reason,
    }));
  }
  if (status === "reactivated") {
    // Personalised the same way the cancellation is: a member whose share is
    // already verified is told it still counts, not handed a 24-hour clock.
    return everyone.map((m) => ({
      to: m.email,
      subject: "Your split order is back on",
      variant: m.status === "paid" ? "already_paid_nothing_to_do" : "owes_within_24h",
    }));
  }
  return []; // no branch matched: this transition emails nobody
}

/** Mirror of emailGroupInvite(): the open share link is never emailed. */
function emailsForInvite(record) {
  if (!record.invited_email) return [];
  return [{ to: record.invited_email, subject: "Split invitation" }];
}

/** Every transition the run has seen, for the completeness check in S13. */
const seenTransitions = new Set();

/** Consume the webhook log and return the emails production would have sent. */
async function drainMail() {
  const { rows } = await db.query(`select * from public._webhook_log order by seq`);
  await db.exec(`delete from public._webhook_log`);
  const out = [];
  for (const row of rows) {
    if (row.table_name === "order_groups") {
      const previous = row.old_record?.status ?? "";
      if (row.record.status !== previous) {
        seenTransitions.add(`${previous}->${row.record.status}`);
      }
      out.push(...(await emailsForGroupUpdate(row.record, row.old_record)));
    } else {
      out.push(...emailsForInvite(row.record));
    }
  }
  return out;
}

const subjectsOf = (mail) => mail.map((m) => m.subject);
const recipientsSorted = (mail) => [...new Set(mail.map((m) => m.to))].sort();
const countOf = (mail, subject) => mail.filter((m) => m.subject === subject).length;

// ===========================================================================
// Actors and fixtures
// ===========================================================================
const ADMIN_EMAIL = process.env.ADMIN_EMAIL ?? "admin@cornell.edu";
await db.exec(`
  do $$ begin
    if to_regclass('public.admin_emails') is not null then
      insert into public.admin_emails (email) values ('${ADMIN_EMAIL}') on conflict do nothing;
    end if;
  end $$;
`);
const admin = await createAuthUser(db, ADMIN_EMAIL);
const club = await createAuthUser(db, "lifeclub@cornell.edu", { club_name: "Lifecycle Club" });
const otherClub = await createAuthUser(db, "otherclub@cornell.edu", { club_name: "Other Club" });

const students = {};
for (const [key, email, first, last, netid] of [
  ["ana", "ana1@cornell.edu", "Ana", "Reyes", "ar101"],
  ["ben", "ben1@cornell.edu", "Ben", "Osei", "bo102"],
  ["cara", "cara1@cornell.edu", "Cara", "Lin", "cl103"],
  ["dev", "dev1@cornell.edu", "Dev", "Shah", "ds104"],
  ["eve", "eve1@cornell.edu", "Eve", "Novak", "en105"],
  ["fin", "fin1@cornell.edu", "Fin", "Brady", "fb106"],
  ["gus", "gus1@cornell.edu", "Gus", "Marek", "gm107"],
  ["hana", "hana1@cornell.edu", "Hana", "Ito", "hi108"],
]) {
  const user = await createAuthUser(db, email);
  await db.query(
    `update public.users_extended
     set first_name = $2, last_name = $3, cornell_netid = $4, cornell_email = $5
     where id = $1`,
    [user.id, first, last, netid, email],
  );
  students[key] = { ...user, first, last, netid };
}

await asUser(db, admin, async () => {
  for (const c of [club, otherClub]) {
    try {
      await db.query(`select public.admin_set_club_approved($1, true)`, [c.id]);
    } catch {
      await db.query(`update public.clubs set approved = true where id = $1`, [c.id]);
    }
  }
});
await db.query(
  `update public.clubs set venmo = 'life-club', zelle_phone = '607-555-0101',
   member_options = '{Aarav,Maya}', groups_enabled = true where id = any($1)`,
  [[club.id, otherClub.id]],
);

async function seedListing(clubId, title) {
  const { rows } = await db.query(
    `insert into public.listings (club_id, brand, title, items, contact_email, active, expires_at)
     values ($1, 'Crumbl', $2, $3::jsonb, 'x@cornell.edu', true, $4) returning id`,
    [clubId, title, JSON.stringify([{ name: "Dozen", price: 24, quantity: 12 }]), future],
  );
  return rows[0].id;
}
// One listing per scenario, deliberately. join_or_create_public_group matches
// ANY open public group with the same item and size on a listing, so a shared
// listing lets a later scenario's joiner land in an earlier scenario's group -
// which silently guts the assertions that follow. Isolating the listings makes
// every match unambiguous.
const L = {};
for (const key of ["happy", "nofill", "unpaid", "early", "extend", "authz", "invite", "noemail"]) {
  L[key] = await seedListing(club.id, `Lifecycle drop (${key})`);
}
const otherListing = await seedListing(otherClub.id, "Other club drop");

// ---- Client-call helpers (same RPCs the pages call) ----
const createGroup = (user, listingId, ways, emails = [], visibility = "public") =>
  asUser(db, user, async () => {
    const { rows } = await db.query(
      `select public.create_order_group($1,'Dozen',$2,$3,$4,$5) as res`,
      [listingId, ways, emails, visibility, ACK],
    );
    return rows[0].res;
  });
const joinPublic = (user, listingId, ways) =>
  asUser(db, user, async () => {
    const { rows } = await db.query(
      `select public.join_or_create_public_group($1,'Dozen',$2,$3) as res`,
      [listingId, ways, ACK],
    );
    return rows[0].res;
  });
const groupRow = async (id) =>
  (await db.query(`select * from public.order_groups where id = $1`, [id])).rows[0];
const membersOf = async (id) =>
  (await db.query(`select * from public.order_group_members where group_id = $1 order by created_at`, [id])).rows;
const runJob = () => db.query(`select public.process_group_deadlines() as r`).then((x) => x.rows[0].r);
const expireOrderDeadline = (id) =>
  db.query(`update public.order_groups set order_deadline = now() - interval '1 minute' where id = $1`, [id]);
const expirePaymentDeadline = (id) =>
  db.query(`update public.order_groups set deadline = now() - interval '1 minute' where id = $1`, [id]);

/**
 * Mirror of verifyGroupPayment() in the edge function, which runs as the
 * service role rather than through an RPC. Same order of operations: refuse
 * unless payment is open, mark the member paid (no-op if already), and flip the
 * group to 'paid' only when nobody is left - which is what releases the passes.
 */
async function clubVerifyMember(clubUser, memberId) {
  const { rows: mrows } = await db.query(`select * from public.order_group_members where id = $1`, [memberId]);
  const member = mrows[0];
  if (!member) throw new Error("Group member not found");
  const group = await groupRow(member.group_id);
  const { rows: owner } = await db.query(
    `select l.club_id from public.listings l where l.id = $1`, [group.listing_id],
  );
  if (owner[0].club_id !== clubUser.id) {
    throw new Error("Only the club that owns this listing can verify payments");
  }
  if (!["payment_in_progress", "reactivated"].includes(group.status)) {
    throw new Error("This group is not collecting payment yet");
  }
  await db.query(
    `update public.order_group_members
     set status = 'paid', qr_encrypted = $2, pickup_code = $3
     where id = $1 and status <> 'paid'`,
    [memberId, `tok-${memberId}`, `CODE${String(memberId).slice(0, 6).toUpperCase()}`],
  );
  if (group.status !== "payment_in_progress") {
    await db.query(`update public.order_groups set status = 'payment_in_progress' where id = $1`, [group.id]);
  }
  const { rows: remaining } = await db.query(
    `select id from public.order_group_members where group_id = $1 and status <> 'paid'`, [group.id],
  );
  if (remaining.length > 0) return { all_paid: false, passes_sent: 0 };

  const { rows: flipped } = await db.query(
    `update public.order_groups set status = 'paid'
     where id = $1 and status in ('payment_in_progress','reactivated') returning id`,
    [group.id],
  );
  if (flipped.length === 0) return { all_paid: true, passes_sent: 0 };
  // Whichever call flipped the group is the one that emails the passes.
  return { all_paid: true, passes_sent: (await recipientsOf(group.id)).length };
}

// ===========================================================================
console.log("S1: mirror is in sync with the edge function");
// ===========================================================================
const edgeSource = readFileSync(EDGE_FN, "utf8");
for (const [label, needle] of [
  ["full", `if (group.status === "full")`],
  ["payment opens", `if (group.status === "payment_in_progress" && previousStatus === "full")`],
  ["reopened for filling", `if (group.status === "filling" && previousStatus === "canceled")`],
  ["canceled", `if (group.status === "canceled")`],
  ["reactivated", `if (group.status === "reactivated")`],
]) {
  check(`edge function still has the "${label}" branch this test mirrors`, edgeSource.includes(needle));
}
check(
  "edge function still stays silent when the status did not change",
  edgeSource.includes("if (group.status === previousStatus) return 0;"),
);
check(
  "edge function still skips emailing the open share link",
  edgeSource.includes("if (!invite.invited_email) return;"),
);
check(
  "webhook still routes order_groups UPDATE into the status handler",
  edgeSource.includes(`payload.table === "order_groups" && payload.type === "UPDATE"`),
);
check(
  "webhook still routes invitation INSERT into the invite mailer",
  edgeSource.includes(`payload.table === "order_group_invitations" && payload.type === "INSERT"`),
);

// The cancellation and reactivation emails are the two halves of one promise to
// a member who already paid, and they have to stay consistent with what
// reactivate_group actually does to a 'paid' row (S8: it leaves it alone). If
// the cancel email flatly promises a refund, that member chases the club for
// money the club may be about to turn back into their order.
check(
  "the cancel email does not flatly promise a refund",
  !edgeSource.includes("owes you a refund."),
);
check(
  "the cancel email tells a paid member the group may reopen instead",
  edgeSource.includes("may reopen the group") && edgeSource.includes("would not be asked to pay again"),
);
check(
  "the cancel email still names the refund as the other outcome",
  edgeSource.includes("the cancellation stands and") && edgeSource.includes("refunds you"),
);
check(
  "the cancel email still says Cornell Craves never held the money",
  edgeSource.includes("Cornell Craves never holds the money"),
);
check(
  "the reactivation email tells an already-paid member their share still counts",
  edgeSource.includes("already paid and still counts") && edgeSource.includes("no refund coming"),
);
check(
  "the reactivation email only puts the 24h clock on members who have not paid",
  edgeSource.includes("If you have not paid your"),
);
check(
  "both emails are personalised per member rather than blasted",
  edgeSource.includes("emailGroupMembersPersonalized(group, \"Your split order was canceled\"") &&
    edgeSource.includes("emailGroupMembersPersonalized(group, \"Your split order is back on\""),
);

// ===========================================================================
console.log("\nS2: happy path, creation to pickup");
// ===========================================================================
const g1 = (await createGroup(students.ana, L.happy, 4, [], "public")).group_id;
await drainMail(); // creation itself is an INSERT: no group webhook, no mail

let mail = [];
await joinPublic(students.ben, L.happy, 4);
mail = await drainMail();
check("filling up quietly: no email while spots remain", mail.length === 0, subjectsOf(mail).join(", "));

await joinPublic(students.cara, L.happy, 4);
await drainMail();
await joinPublic(students.dev, L.happy, 4);
mail = await drainMail();

let g = await groupRow(g1);
check("group flips to 'full' when the last spot is taken", g.status === "full", `got ${g.status}`);
check('"full" emails every member once', countOf(mail, "Your split order is full") === 4, subjectsOf(mail).join(", "));
check(
  '"full" reaches exactly the four members',
  recipientsSorted(mail).join(",") === "ana1@cornell.edu,ben1@cornell.edu,cara1@cornell.edu,dev1@cornell.edu",
  recipientsSorted(mail).join(","),
);
let mem = await membersOf(g1);
check("a full group owes nothing yet (no member is pending_payment)", mem.every((m) => m.status !== "pending_payment"));

// Orders close on schedule -> the 24h payment window opens.
await expireOrderDeadline(g1);
let jobResult = await runJob();
mail = await drainMail();
g = await groupRow(g1);
check("the hourly job opens payment once the order deadline passes", g.status === "payment_in_progress", `got ${g.status}`);
check("job reports one group opened", Number(jobResult.opened) === 1, JSON.stringify(jobResult));
check('"time to pay" emails all four', countOf(mail, "Time to pay your split share") === 4, subjectsOf(mail).join(", "));
mem = await membersOf(g1);
check("every member is moved to pending_payment", mem.every((m) => m.status === "pending_payment"));
check(
  "the pay-by deadline is ~24h out, as the rules promise",
  Math.abs((new Date(g.deadline) - Date.now()) / 3600e3 - 24) < 0.2,
  `${((new Date(g.deadline) - Date.now()) / 3600e3).toFixed(2)}h`,
);

// Members declare how they will pay.
for (const key of ["ana", "ben", "cara", "dev"]) {
  await asUser(db, students[key], () =>
    db.query(`select public.set_group_member_payment($1,'venmo',$2)`, [g1, `${key}-handle`]),
  );
}
await drainMail();

// The club checks members off one at a time. Nothing unlocks until the last one.
for (const [index, key] of ["ana", "ben", "cara"].entries()) {
  const member = (await membersOf(g1)).find((m) => m.user_id === students[key].id);
  const res = await clubVerifyMember(club, member.id);
  mail = await drainMail();
  check(`verify ${index + 1}/4 does not release passes`, res.all_paid === false && res.passes_sent === 0);
  check(`verify ${index + 1}/4 sends no email at all`, mail.length === 0, subjectsOf(mail).join(", "));
  const own = await asUser(db, students[key], async () => {
    const { rows } = await db.query(`select public.get_my_groups() as p`);
    return rows.map((r) => r.p).find((p) => p.id === g1);
  });
  check(`member ${index + 1}/4 still has no QR while others owe`, own.my_qr === "" && own.my_pickup_code === null);
}

const lastMember = (await membersOf(g1)).find((m) => m.user_id === students.dev.id);
const lastRes = await clubVerifyMember(club, lastMember.id);
mail = await drainMail();
g = await groupRow(g1);
check("verifying the last share flips the group to 'paid'", g.status === "paid", `got ${g.status}`);
check("all_paid is reported back to the dashboard", lastRes.all_paid === true);
check("passes are emailed to all four at that moment", lastRes.passes_sent === 4, `sent ${lastRes.passes_sent}`);
check(
  "'paid' is a deliberately silent transition for the status webhook",
  mail.length === 0,
  `unexpected: ${subjectsOf(mail).join(", ")}`,
);
for (const key of ["ana", "ben", "cara", "dev"]) {
  const own = await asUser(db, students[key], async () => {
    const { rows } = await db.query(`select public.get_my_groups() as p`);
    return rows.map((r) => r.p).find((p) => p.id === g1);
  });
  check(`${key} can now see their QR and pickup code`, own.my_qr !== "" && own.my_pickup_code !== null);
}

// Pickup.
await db.query(`update public.order_group_members set scanned_at = now() where id = $1`, [lastMember.id]);
check("a scanned member records their pickup", (await membersOf(g1)).find((m) => m.id === lastMember.id).scanned_at !== null);

// ===========================================================================
console.log("\nS3: never fills -> auto-cancel, nobody charged");
// ===========================================================================
const g2 = (await createGroup(students.eve, L.nofill, 4, [], "public")).group_id;
await joinPublic(students.fin, L.nofill, 4);
await drainMail();

await expireOrderDeadline(g2);
jobResult = await runJob();
mail = await drainMail();
g = await groupRow(g2);
check("a group that never fills is canceled at its order deadline", g.status === "canceled", `got ${g.status}`);
check("job counts it as a fill cancellation", Number(jobResult.canceled_fill) === 1, JSON.stringify(jobResult));
check("cancel email goes to both members", countOf(mail, "Your split order was canceled") === 2, subjectsOf(mail).join(", "));
check('the reason given is "did not fill in time"', mail.every((m) => m.reason === "did not fill in time"), mail[0]?.reason);
check("nobody is told they were charged", mail.every((m) => m.variant === "not_charged"));
check("no member was left holding a paid status", (await membersOf(g2)).every((m) => m.status !== "paid"));

// ===========================================================================
console.log("\nS4: fills, then someone never pays -> cancel + refund owed");
// ===========================================================================
const g3 = (await createGroup(students.ana, L.unpaid, 2, [], "public")).group_id;
await joinPublic(students.ben, L.unpaid, 2);
await drainMail();
await expireOrderDeadline(g3);
await runJob();
await drainMail();

const anaMember3 = (await membersOf(g3)).find((m) => m.user_id === students.ana.id);
await clubVerifyMember(club, anaMember3.id); // one share in, one still owed
await drainMail();

await expirePaymentDeadline(g3);
jobResult = await runJob();
mail = await drainMail();
g = await groupRow(g3);
check("an unpaid group is canceled when its payment window elapses", g.status === "canceled", `got ${g.status}`);
check("job counts it as a payment cancellation", Number(jobResult.canceled_pay) === 1, JSON.stringify(jobResult));
check('the reason given is "before everyone paid"', mail.every((m) => m.reason === "before everyone paid"));
const anaMail = mail.find((m) => m.to === "ana1@cornell.edu");
const benMail = mail.find((m) => m.to === "ben1@cornell.edu");
check("the member who already paid is told a refund is owed", anaMail?.variant === "refund_owed", anaMail?.variant);
check("the member who never paid is told they were not charged", benMail?.variant === "not_charged", benMail?.variant);
check(
  "the paid member keeps status 'paid', so the club can still see what to refund",
  (await membersOf(g3)).find((m) => m.user_id === students.ana.id).status === "paid",
);

// ===========================================================================
console.log("\nS5: club closes ordering early");
// ===========================================================================
const g4 = (await createGroup(students.cara, L.early, 2, [], "public")).group_id;
await joinPublic(students.dev, L.early, 2);
await drainMail();
check("group is full but not yet payable", (await groupRow(g4)).status === "full");

await asUser(db, club, () => db.query(`select public.open_group_payment($1, null)`, [g4]));
mail = await drainMail();
g = await groupRow(g4);
check("open_group_payment starts the payment window immediately", g.status === "payment_in_progress", `got ${g.status}`);
check('closing orders early still sends "time to pay"', countOf(mail, "Time to pay your split share") === 2, subjectsOf(mail).join(", "));
check(
  "the 24h clock starts from the moment the club closed orders",
  Math.abs((new Date(g.deadline) - Date.now()) / 3600e3 - 24) < 0.2,
);
check("members are moved to pending_payment", (await membersOf(g4)).every((m) => m.status === "pending_payment"));

// ===========================================================================
console.log("\nS6: club extends deadlines instead of letting the job cancel");
// ===========================================================================
const g5 = (await createGroup(students.eve, L.extend, 4, [], "public")).group_id;
await joinPublic(students.fin, L.extend, 4);
await drainMail();
await expireOrderDeadline(g5);
await asUser(db, club, () => db.query(`select public.club_extend_deadlines('order', 24, $1, null)`, [g5]));
await drainMail();
jobResult = await runJob();
mail = await drainMail();
check("extending the order deadline saves a group from auto-cancel", (await groupRow(g5)).status === "filling", (await groupRow(g5)).status);
check("...and the job cancels nothing", Number(jobResult.canceled_fill) === 0, JSON.stringify(jobResult));
check("...and no member is emailed about a cancellation", countOf(mail, "Your split order was canceled") === 0);

// Payment-side extension on the group left open in S5.
await expirePaymentDeadline(g4);
await asUser(db, club, () => db.query(`select public.club_extend_deadlines('payment', 24, $1, null)`, [g4]));
await drainMail();
jobResult = await runJob();
mail = await drainMail();
check("extending the payment deadline saves a group mid-collection", (await groupRow(g4)).status === "payment_in_progress");
check("...and the job cancels nothing", Number(jobResult.canceled_pay) === 0, JSON.stringify(jobResult));
check("...and nobody is emailed", mail.length === 0, subjectsOf(mail).join(", "));

// ===========================================================================
console.log("\nS7: reactivating a group that never filled");
// ===========================================================================
await asUser(db, club, () => db.query(`select public.reactivate_group($1) as r`, [g2]));
mail = await drainMail();
g = await groupRow(g2);
check("a never-filled group reopens to 'filling'", g.status === "filling", `got ${g.status}`);
check('members are told it is "open again"', countOf(mail, "Your split order is open again") === 2, subjectsOf(mail).join(", "));
check("it gets a fresh order deadline in the future", new Date(g.order_deadline) > new Date());
const rejoin = await attempt(() => joinPublic(students.gus, L.nofill, 4));
check("a reopened group accepts new members again", rejoin.ok, rejoin.ok ? "" : rejoin.message);
check(
  "...and the new member lands in the reopened group, not a fresh one",
  rejoin.ok && rejoin.value.group_id === g2 && (await membersOf(g2)).length === 3,
  rejoin.ok ? `joined ${rejoin.value.group_id}` : "",
);
await drainMail();

// ===========================================================================
console.log("\nS8: reactivating a group that was canceled over payment");
// ===========================================================================
const reMode = await asUser(db, club, async () => {
  const { rows } = await db.query(`select public.reactivate_group($1) as r`, [g3]);
  return rows[0].r;
});
mail = await drainMail();
g = await groupRow(g3);
check("a filled-but-unpaid group reopens into payment mode", reMode.mode === "payment", JSON.stringify(reMode));
check("...with status 'reactivated'", g.status === "reactivated", `got ${g.status}`);
check('members are told it is "back on"', countOf(mail, "Your split order is back on") === 2, subjectsOf(mail).join(", "));
// Ana paid before the cancel and was told a refund might be coming; this is the
// email that has to resolve that, so it must not read as a fresh demand.
check(
  "the member who already paid is told their share still counts, not to pay again",
  mail.find((m) => m.to === "ana1@cornell.edu")?.variant === "already_paid_nothing_to_do",
  mail.find((m) => m.to === "ana1@cornell.edu")?.variant,
);
check(
  "the member who never paid is the one given the 24-hour clock",
  mail.find((m) => m.to === "ben1@cornell.edu")?.variant === "owes_within_24h",
  mail.find((m) => m.to === "ben1@cornell.edu")?.variant,
);
check("...and given another 24 hours", Math.abs((new Date(g.deadline) - Date.now()) / 3600e3 - 24) < 0.2);
// reactivate_group resets 'accepted' / 'invited' / 'pending_payment' but
// deliberately leaves 'paid' alone: a member who already sent money must not be
// asked for it twice just because the club reopened the group. The "back on"
// email is worded to match ("anyone who has not paid ... has 24 hours").
check(
  "a member who already paid is NOT asked to pay again",
  (await membersOf(g3)).find((m) => m.user_id === students.ana.id).status === "paid",
  (await membersOf(g3)).find((m) => m.user_id === students.ana.id).status,
);
check(
  "...while the member who never paid is put back on the clock",
  (await membersOf(g3)).find((m) => m.user_id === students.ben.id).status === "pending_payment",
);
const benMember3 = (await membersOf(g3)).find((m) => m.user_id === students.ben.id);
const reVerify = await attempt(() => clubVerifyMember(club, benMember3.id));
check("the club can verify shares again on a reactivated group", reVerify.ok, reVerify.ok ? "" : reVerify.message);
check(
  "verifying the one outstanding share completes the group",
  reVerify.ok && reVerify.value.all_paid === true && (await groupRow(g3)).status === "paid",
  reVerify.ok ? JSON.stringify(reVerify.value) : "",
);
check(
  "...and passes go out to both members, including the one who paid before the cancel",
  reVerify.ok && reVerify.value.passes_sent === 2,
  reVerify.ok ? `sent ${reVerify.value.passes_sent}` : "",
);
await drainMail();

// ===========================================================================
console.log("\nS9: verification is refused before payment opens");
// ===========================================================================
const g6 = (await createGroup(students.gus, L.authz, 2, [], "public")).group_id;
await joinPublic(students.hana, L.authz, 2);
await drainMail();
const earlyMember = (await membersOf(g6))[0];
let res = await attempt(() => clubVerifyMember(club, earlyMember.id));
check("a merely-full group cannot be verified yet", !res.ok, res.ok ? "was allowed" : "");
res = await attempt(() => clubVerifyMember(otherClub, earlyMember.id));
check("another club cannot verify someone else's member", !res.ok, res.ok ? "was allowed" : "");
res = await attempt(() =>
  asUser(db, otherClub, () => db.query(`select public.open_group_payment($1, null)`, [g6])),
);
check("another club cannot open payment on this group", !res.ok, res.ok ? "was allowed" : "");
res = await attempt(() =>
  asUser(db, otherClub, () => db.query(`select public.club_extend_deadlines('order', 24, $1, null)`, [g6])),
);
check("another club cannot extend this group's deadline", !res.ok, res.ok ? "was allowed" : "");
res = await attempt(() => asUser(db, students.ana, () => db.query(`select public.reactivate_group($1)`, [g2])));
check("a student cannot reactivate a group", !res.ok, res.ok ? "was allowed" : "");
await drainMail();

// ===========================================================================
console.log("\nS10: invitations email the invited, never the share link");
// ===========================================================================
const g7 = await createGroup(students.ana, otherListing, 2, ["hana1@cornell.edu"], "private");
mail = await drainMail();
check("a targeted invite emails exactly that address", mail.length === 1 && mail[0].to === "hana1@cornell.edu", JSON.stringify(mail));

const g8 = await createGroup(students.ana, L.invite, 2, [], "public");
mail = await drainMail();
check("a public group's open share link emails nobody", mail.length === 0, JSON.stringify(mail));

await asUser(db, students.ana, () =>
  db.query(`select public.invite_to_group($1, $2)`, [g8.group_id, ["cara1@cornell.edu", "dev1@cornell.edu"]]),
);
mail = await drainMail();
check("inviting two friends emails two people", mail.length === 2, JSON.stringify(mail));
await asUser(db, students.ana, () =>
  db.query(`select public.invite_to_group($1, $2)`, [g8.group_id, ["cara1@cornell.edu"]]),
);
mail = await drainMail();
check("re-inviting the same address does not email again", mail.length === 0, JSON.stringify(mail));

const flood = await attempt(() =>
  asUser(db, students.ana, () =>
    db.query(`select public.invite_to_group($1, $2)`, [
      g8.group_id,
      Array.from({ length: 60 }, (_, i) => `flood${i}@cornell.edu`),
    ]),
  ),
);
mail = await drainMail();
check("a mass invite is refused rather than fanning out email", !flood.ok, flood.ok ? "was allowed" : "");
check("...and sends nothing", mail.length === 0, `${mail.length} emails`);

// ===========================================================================
console.log("\nS11: the club sees member contacts, nobody else does (053)");
// ===========================================================================
const clubView = await asUser(db, club, async () => {
  const { rows } = await db.query(`select public.get_club_groups() as p`);
  return rows.map((r) => r.p).find((p) => p.id === g1);
});
const clubMembers = clubView.members;
check("get_club_groups returns every member", clubMembers.length === 4, `${clubMembers.length}`);
check(
  "the club sees each member's email",
  clubMembers.map((m) => m.email).sort().join(",") ===
    "ana1@cornell.edu,ben1@cornell.edu,cara1@cornell.edu,dev1@cornell.edu",
  clubMembers.map((m) => m.email).join(","),
);
check(
  "the club sees each member's NetID",
  clubMembers.map((m) => m.netid).sort().join(",") === "ar101,bo102,cl103,ds104",
  clubMembers.map((m) => m.netid).join(","),
);
check(
  "contacts line up with the right member",
  clubMembers.every((m) => {
    const student = Object.values(students).find((s) => s.id === m.user_id);
    return student && m.email === `${student.first.toLowerCase()}1@cornell.edu` && m.netid === student.netid;
  }),
);
check("the club still sees payment handles", clubMembers.every((m) => m.payment_handle));
check("member ordering is preserved by the contact join", clubMembers[0].user_id === students.ana.id);

const studentView = await asUser(db, students.ana, async () => {
  const { rows } = await db.query(`select public.get_my_groups() as p`);
  return rows.map((r) => r.p).find((p) => p.id === g1);
});
check(
  "a student never sees co-members' emails",
  studentView.members.every((m) => m.email === undefined),
  JSON.stringify(studentView.members.map((m) => m.email)),
);
check(
  "a student never sees co-members' NetIDs",
  studentView.members.every((m) => m.netid === undefined),
);
// What a student DOES see about co-members. Both are by design (051 keeps the
// handles for members and the club, and strips them only from the anon copy) -
// pinned here because SPLIT_RULES discloses exactly this to the student, and a
// disclosure that does not match the system is worse than none.
check(
  "a student sees co-members as first name + last initial only",
  studentView.members.every((m) => /^[A-Z][a-z]+( [A-Z])?$/.test(m.name) || m.name === "Student"),
  studentView.members.map((m) => m.name).join(", "),
);
check(
  "a student CAN see co-members' payment handles, as the rules disclose",
  studentView.members.some((m) => Boolean(m.payment_handle)),
  JSON.stringify(studentView.members.map((m) => m.payment_handle)),
);

const { rows: tokenRow } = await db.query(
  `select invite_link_token from public.order_group_invitations where group_id = $1 and invited_email is not null limit 1`,
  [g7.group_id],
);
const anonView = await asUser(db, null, async () => {
  const { rows } = await db.query(`select public.get_group_by_token($1) as p`, [tokenRow[0].invite_link_token]);
  return rows[0].p;
});
check(
  "the anon invite preview carries no emails",
  anonView.members.every((m) => m.email === undefined),
  JSON.stringify(anonView.members),
);
check("the anon invite preview carries no NetIDs", anonView.members.every((m) => m.netid === undefined));
check(
  "the anon invite preview still hides payment handles (051)",
  anonView.members.every((m) => m.payment_handle === undefined),
);

const otherClubView = await asUser(db, otherClub, async () => {
  const { rows } = await db.query(`select public.get_club_groups() as p`);
  return rows.map((r) => r.p);
});
check(
  "a club sees only its own listings' groups",
  otherClubView.every((p) => p.listing_id === otherListing),
  otherClubView.map((p) => p.listing_id).join(","),
);
const direct = await attempt(() =>
  asUser(db, students.ana, () => db.query(`select public.group_payload($1)`, [g1])),
);
check("group_payload is still not callable by a client (052)", !direct.ok, direct.ok ? "was allowed" : "");

// ===========================================================================
console.log("\nS12: a member with no profile email is skipped, not crashed on");
// ===========================================================================
const ghost = await createAuthUser(db, "ghost1@cornell.edu");
await db.query(`update public.users_extended set cornell_email = '' where id = $1`, [ghost.id]);
const g9 = (await createGroup(students.hana, L.noemail, 2, [], "public")).group_id;
await joinPublic(ghost, L.noemail, 2);
mail = await drainMail();
check(
  "the auth address is used when the profile email is blank",
  recipientsSorted(mail).includes("ghost1@cornell.edu"),
  recipientsSorted(mail).join(","),
);
await db.query(`update auth.users set email = null where id = $1`, [ghost.id]);
await expireOrderDeadline(g9);
await runJob();
mail = await drainMail();
check(
  "a member with no address anywhere is skipped without breaking the send",
  countOf(mail, "Time to pay your split share") === 1 && !recipientsSorted(mail).includes(null),
  `${countOf(mail, "Time to pay your split share")} sent to ${recipientsSorted(mail).join(",")}`,
);

// ===========================================================================
console.log("\nS13: every transition this run produced is accounted for");
// ===========================================================================
// A transition is "accounted for" if the mirror emails on it, or it is listed
// here as deliberately silent with the reason why. Anything else means a group
// changed state and no student was told - the exact failure this suite exists
// to catch.
const SILENT_BY_DESIGN = {
  "->filling": "row created; the INSERT is not the update webhook",
  "filling->full": "handled: 'Your split order is full'",
  "payment_in_progress->paid": "passes are emailed by verifyGroupPayment, not the status webhook",
  "reactivated->paid": "same as above, via a reactivated group",
  "reactivated->payment_in_progress": "verifyGroupPayment normalises the status; members were already told at 'reactivated'",
  "full->canceled": "handled: cancellation email",
};
const EMAILING = new Set([
  "filling->full",
  "full->payment_in_progress",
  "canceled->filling",
  "canceled->reactivated",
  "filling->canceled",
  "payment_in_progress->canceled",
  "reactivated->canceled",
  "full->canceled",
]);
const unaccounted = [...seenTransitions].filter(
  (t) => !EMAILING.has(t) && !(t in SILENT_BY_DESIGN),
);
check(
  `all ${seenTransitions.size} observed transitions are handled or deliberately silent`,
  unaccounted.length === 0,
  `unaccounted: ${unaccounted.join(", ")}`,
);
console.log(`  seen: ${[...seenTransitions].sort().join(", ")}`);

// ===========================================================================
console.log("\nS14: the rules students accept match what the system does");
// ===========================================================================
// SPLIT_RULES / CLUB_SPLIT_RULES are the only thing a student formally agrees
// to, and every line is a factual claim about behaviour asserted above. A rule
// that overstates the system is not a harmless disclaimer - it is a promise the
// project then breaks. These checks tie each claim back to the scenario that
// proves it, so editing one without the other fails here.
const rules = readFileSync(RULES_FILE, "utf8");
const csvSource = readFileSync(CSV_FILE, "utf8");

check(
  "the rules version is bumped past the pre-reactivation text (v2)",
  /SPLIT_RULES_VERSION = "\d{4}-\d{2}-\d{2}\.v\d+"/.test(rules) && !rules.includes('"2026-08-17.v2"'),
  (rules.match(/SPLIT_RULES_VERSION = "([^"]+)"/) ?? [])[1],
);
// S8: reactivate_group leaves a 'paid' row alone, so a flat refund promise is
// false whenever the club reopens instead.
check(
  "the student rules no longer promise a refund unconditionally",
  !rules.includes("the club refunds you directly — Cornell Craves never held that money"),
);
check(
  "the student rules describe reactivation as the other outcome (S8)",
  rules.includes("your payment still counts, you will not be asked to pay again"),
);
check(
  "the student rules disclaim any power to force a refund",
  rules.includes("cannot issue, guarantee, or compel a refund"),
);
// S11: the club really does receive these, so the student is told.
check(
  "the student rules disclose what the club can see (S11)",
  rules.includes("can see your name, Cornell email, NetID, and the payment handle"),
);
check(
  "the student rules disclose that co-members see the payment handle (S11)",
  rules.includes("Other members of your group can see your first name, last initial, and payment handle"),
);
// S12 + the edge function: a failed send is logged and swallowed, never retried.
check(
  "sending really is best-effort in the edge function",
  edgeSource.includes("console.error(`Group email failed for"),
);
check(
  "the student rules say delivery is not guaranteed and the deadline runs anyway",
  rules.includes("delivery is not guaranteed") && rules.includes("Deadlines run whether or not a message reaches you"),
);
// process_group_deadlines is service-role only and runs on a cron, so timing is
// approximate by design.
check(
  "the student rules say deadlines are applied by a scheduled job",
  rules.includes("applied by an automated job that runs on a schedule"),
);
check(
  "the student rules state passes are single-use",
  rules.includes("personal and single-use"),
);
// Club side.
check(
  "the club rules offer refund OR reactivation, not refund alone",
  rules.includes("a refund, or a reactivation") && rules.includes("that member is not asked to pay again"),
);
check(
  "the club rules restrict what it may do with member contact details (053)",
  rules.includes("Use them only to run and fulfil that order") &&
    rules.includes("Do not use them for marketing"),
);
check(
  "the club rules make verification a representation that money arrived",
  rules.includes("Verifying is your representation that the money arrived"),
);
// The export has to speak the same language as the rules and the dashboard.
check(
  "the CSV names both outcomes rather than only a refund",
  csvSource.includes("paid_refund_or_reactivate") && !csvSource.includes('"paid_refund_owed"'),
);

summary();
