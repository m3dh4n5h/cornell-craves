// Cornell Craves: owner + multi-admin roster (migration 046).
//
// Boots every migration on a real Postgres and drives the roster exactly the
// way AdminRoster.tsx does, as three different people: the owner, an ordinary
// admin, and a signed-out visitor. The point of these scenarios is that the
// guards live in the DATABASE, so a bypassed UI check changes nothing.
import { boot, asUser, check, summary } from "./harness.mjs";

const db = await boot();

const OWNER = { id: "00000000-0000-0000-0000-0000000000a1", email: "owner@example.com" };
const OPS = { id: "00000000-0000-0000-0000-0000000000a2", email: "ops@example.com" };
const RANDOM = { id: "00000000-0000-0000-0000-0000000000a3", email: "student@example.com" };

/** Run a statement as `user`; resolve to { ok, error } instead of throwing. */
async function attempt(user, sql, params = []) {
  return asUser(db, user, async () => {
    try {
      const res = await db.query(sql, params);
      return { ok: true, rows: res.rows };
    } catch (e) {
      return { ok: false, error: e.message };
    }
  });
}
const boolAs = async (user, sql) => (await attempt(user, sql)).rows?.[0]?.v;
const refused = (result, needle) =>
  !result.ok && (!needle || result.error.toLowerCase().includes(needle.toLowerCase()));

console.log("\n-- Before an owner is seeded --");
// 042 seeds nobody, so the roster starts empty and NOBODY can manage it.
check(
  "no owner exists yet",
  (await db.query(`select count(*)::int as n from public.admin_emails where role='owner'`)).rows[0].n === 0,
);
check(
  "management refuses even a would-be admin",
  refused(await attempt(OWNER, `select public.admin_add_admin('x@example.com')`), "owner"),
);

console.log("\n-- Seeding the owner (the line documented in the migration header) --");
await db.exec(`insert into public.admin_emails (email, role, status)
  values (lower('Owner@Example.com'), 'owner', 'active')
  on conflict (email) do update set role='owner', status='active';`);
check("is_owner() true for the owner", (await boolAs(OWNER, `select public.is_owner() as v`)) === true);
check("is_admin() true for the owner", (await boolAs(OWNER, `select public.is_admin() as v`)) === true);
check("is_owner() false for a random student", (await boolAs(RANDOM, `select public.is_owner() as v`)) === false);
check("is_admin() false for a random student", (await boolAs(RANDOM, `select public.is_admin() as v`)) === false);

console.log("\n-- Exactly one owner, enforced by the database --");
// Two independent guards. First: RLS on admin_emails has no policies at all, so
// no client can touch the table directly whatever their role.
check(
  "a signed-in admin cannot write the roster table directly",
  !(await attempt(OWNER, `insert into public.admin_emails (email, role, status) values ('other@example.com','owner','active')`)).ok,
);
// Second: even with RLS out of the picture (a superuser, or a future
// SECURITY DEFINER that forgets to check), the unique index still refuses.
let secondOwnerRejected = false;
try {
  await db.exec(`insert into public.admin_emails (email, role, status) values ('other@example.com','owner','active')`);
} catch (e) {
  secondOwnerRejected = /unique|duplicate/i.test(e.message);
}
check("a second owner is rejected by the unique index, even as superuser", secondOwnerRejected);

console.log("\n-- Owner adds an admin --");
check(
  "add, with padding and mixed case",
  (await attempt(OWNER, `select public.admin_add_admin('  OPS@Example.com  ', ' Ops lead ')`)).ok,
);
const stored = (await db.query(`select email, label, role, status, added_by from public.admin_emails where lower(email)='ops@example.com'`)).rows;
check("stored once, trimmed and lowercased", stored.length === 1 && stored[0].email === "ops@example.com", JSON.stringify(stored));
check("label trimmed", stored[0]?.label === "Ops lead");
check("recorded who added them", stored[0]?.added_by === OWNER.email);
check("added as 'admin', never 'owner'", stored[0]?.role === "admin");
check(
  "malformed address rejected",
  refused(await attempt(OWNER, `select public.admin_add_admin('not-an-email')`), "email"),
);

console.log("\n-- The new admin has every admin power EXCEPT the roster --");
check("passes is_admin()", (await boolAs(OPS, `select public.is_admin() as v`)) === true);
check("is not the owner", (await boolAs(OPS, `select public.is_owner() as v`)) === false);
for (const [label, sql] of [
  ["list the roster", `select * from public.admin_list_admins()`],
  ["add another admin", `select public.admin_add_admin('sneaky@example.com')`],
  ["suspend the owner", `select public.admin_set_admin_status('owner@example.com','suspended')`],
  ["remove the owner", `select public.admin_remove_admin('owner@example.com')`],
  ["suspend a peer", `select public.admin_set_admin_status('ops@example.com','suspended')`],
]) {
  check(`admin cannot ${label}`, refused(await attempt(OPS, sql), "owner"));
}

console.log("\n-- A signed-out visitor gets nowhere --");
for (const [label, sql] of [
  ["list the roster", `select * from public.admin_list_admins()`],
  ["add an admin", `select public.admin_add_admin('x@example.com')`],
]) {
  check(`anon cannot ${label}`, !(await attempt(null, sql)).ok);
}

console.log("\n-- The owner cannot lock themselves out --");
check(
  "cannot suspend self",
  refused(await attempt(OWNER, `select public.admin_set_admin_status('owner@example.com','suspended')`), "cannot be suspended"),
);
check(
  "cannot remove self",
  refused(await attempt(OWNER, `select public.admin_remove_admin('owner@example.com')`), "cannot be removed"),
);
check(
  "cannot overwrite the owner row via add",
  refused(await attempt(OWNER, `select public.admin_add_admin('owner@example.com')`), "owner"),
);
check(
  "bogus status value rejected",
  refused(await attempt(OWNER, `select public.admin_set_admin_status('ops@example.com','superuser')`), "active or suspended"),
);

console.log("\n-- Suspension takes effect immediately --");
check("owner suspends ops", (await attempt(OWNER, `select public.admin_set_admin_status('ops@example.com','suspended')`)).ok);
check("suspended admin fails is_admin() at once", (await boolAs(OPS, `select public.is_admin() as v`)) === false);
check("owner reactivates ops", (await attempt(OWNER, `select public.admin_set_admin_status('ops@example.com','active')`)).ok);
check("reactivated admin passes again", (await boolAs(OPS, `select public.is_admin() as v`)) === true);

console.log("\n-- Re-adding a suspended address brings them back --");
await attempt(OWNER, `select public.admin_set_admin_status('ops@example.com','suspended')`);
check("re-add a suspended address", (await attempt(OWNER, `select public.admin_add_admin('ops@example.com')`)).ok);
const back = (await db.query(`select status, label from public.admin_emails where email='ops@example.com'`)).rows[0];
check("came back active", back?.status === "active");
check("existing label preserved when none supplied", back?.label === "Ops lead");

console.log("\n-- Roster listing and removal --");
const roster = (await attempt(OWNER, `select * from public.admin_list_admins()`)).rows ?? [];
check("owner sees both entries", roster.length === 2, JSON.stringify(roster));
check("owner is pinned first", roster[0]?.role === "owner");
check("remove accepts mixed case", (await attempt(OWNER, `select public.admin_remove_admin('OPS@example.com')`)).ok);
check(
  "only the owner remains",
  (await db.query(`select count(*)::int as n from public.admin_emails`)).rows[0].n === 1,
);
check("removing a missing address is a no-op, not an error", (await attempt(OWNER, `select public.admin_remove_admin('gone@example.com')`)).ok);

console.log("\n-- Suspension really does revoke platform powers, not just the roster --");
// The point of routing status through is_admin(): every RLS policy in the
// schema that trusts is_admin() now respects suspension too.
await attempt(OWNER, `select public.admin_add_admin('ops@example.com')`);
check("active admin can read the admin overview", (await attempt(OPS, `select public.admin_overview()`)).ok);
await attempt(OWNER, `select public.admin_set_admin_status('ops@example.com','suspended')`);
const afterSuspend = await attempt(OPS, `select public.admin_overview()`);
check(
  "suspended admin is locked out of admin RPCs",
  !afterSuspend.ok || (await boolAs(OPS, `select public.is_admin() as v`)) === false,
);

summary();
