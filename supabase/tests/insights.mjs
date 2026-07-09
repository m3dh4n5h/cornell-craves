// Edge cases for migrations 041 (admin_insights) + 042 (admin_emails registry).
// Verifies the RPC returns real aggregates for the admin, nulls for everyone
// else, and that is_admin() fails closed when the registry is empty.
import { boot, asUser, createAuthUser, check, summary } from "./harness.mjs";

const ADMIN_EMAIL = process.env.ADMIN_EMAIL ?? "admin@cornell.edu";
const db = await boot();

const admin = await createAuthUser(db, ADMIN_EMAIL);
const club = await createAuthUser(db, "club@cornell.edu", { club_name: "Insights Club" });
const student = await createAuthUser(db, "stu@cornell.edu");

console.log("I1: is_admin() fails closed before the registry is seeded");
await asUser(db, admin, async () => {
  const { rows } = await db.query("select public.is_admin() as ok");
  check("unseeded registry -> not admin", rows[0].ok === false);
});

await db.exec(
  `insert into public.admin_emails (email) values ('${ADMIN_EMAIL}') on conflict do nothing;`,
);

console.log("\nI2: seeding the registry grants admin (case-insensitive)");
await asUser(db, admin, async () => {
  const { rows } = await db.query("select public.is_admin() as ok");
  check("seeded email recognized", rows[0].ok === true);
});
await asUser(db, student, async () => {
  const { rows } = await db.query("select public.is_admin() as ok");
  check("student still not admin", rows[0].ok === false);
});

console.log("\nI3: registry table is unreadable to non-admin clients");
await asUser(db, student, async () => {
  const { rows } = await db.query("select count(*)::int as n from public.admin_emails");
  check("RLS hides admin_emails rows", rows[0].n === 0);
});

// Approve the club the same way the admin UI does (a trigger blocks direct
// updates to clubs.approved), then seed a verified order so insights has
// something to aggregate. Mirrors the shape create_order writes.
await asUser(db, admin, async () => {
  await db.query("select public.admin_set_club_approved($1, true)", [club.id]);
});
await db.exec(`
  insert into public.listings (club_id, brand, title, items, active, expires_at, contact_email)
  values ('${club.id}', 'Krispy Kreme', 'Dozen drop', '[{"name":"Glazed dozen","price":14.99}]',
          true, now() + interval '1 day', 'club@cornell.edu');
  insert into public.orders (listing_id, user_id, orderer_name, orderer_email, orderer_netid,
                             items_json, total, payment_method, payment_verified, status)
  select l.id, '${student.id}', 'Stu Dent', 'stu@cornell.edu', 'std1',
         '[{"name":"Glazed dozen","price":14.99,"qty":2}]', 29.98, 'venmo', true, 'qr_sent'
  from public.listings l where l.club_id = '${club.id}';
`);

console.log("\nI4: admin_insights aggregates for the admin");
await asUser(db, admin, async () => {
  const { rows } = await db.query("select public.admin_insights() as ins");
  const ins = rows[0].ins;
  check("returns a payload", ins !== null);
  check("daily trend has today's revenue", Array.isArray(ins.daily) && ins.daily.length === 1 && Number(ins.daily[0].revenue) === 29.98);
  check("top item aggregates units", ins.top_items?.[0]?.name === "Glazed dozen" && Number(ins.top_items[0].units) === 2);
  check("heatmap counts the order", Array.isArray(ins.heatmap) && ins.heatmap.reduce((s, c) => s + Number(c.orders), 0) === 1);
  check("buyer counts are sane", ins.buyers_total === 1 && ins.buyers_repeat === 0 && ins.buyers_new_30d === 1);
  check("avg order value", Number(ins.avg_order_value_30d) === 29.98);
});

console.log("\nI5: admin_insights returns null for club and student");
await asUser(db, club, async () => {
  const { rows } = await db.query("select public.admin_insights() as ins");
  check("club gets null", rows[0].ins === null);
});
await asUser(db, student, async () => {
  const { rows } = await db.query("select public.admin_insights() as ins");
  check("student gets null", rows[0].ins === null);
});

summary();
