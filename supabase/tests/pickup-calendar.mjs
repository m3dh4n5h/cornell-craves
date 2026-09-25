// Migrations 056/057: group_payload() and get_my_orders() now carry
// pickup_info, expires_at, location_name and the listing's own pickup_spots
// (each with a fixed start/end where the club set one, plus coordinates) -
// feature 3, the "Add to calendar" button. Confirms the fields reach all
// callers, including the anon invite preview, without disturbing 051's
// existing member-field stripping there.
//
//   npm i --no-save @electric-sql/pglite   # one time
//   node supabase/tests/pickup-calendar.mjs
import { boot, asUser, createAuthUser, check, summary } from "./harness.mjs";

const db = await boot();
console.log("Booted with all migrations\n");

const future = new Date(Date.now() + 48 * 3600e3).toISOString();
const ACK = "test-rules-v1";

const ADMIN_EMAIL = process.env.ADMIN_EMAIL ?? "admin@cornell.edu";
await db.exec(`
  do $$ begin
    if to_regclass('public.admin_emails') is not null then
      insert into public.admin_emails (email) values ('${ADMIN_EMAIL}') on conflict do nothing;
    end if;
  end $$;
`);
const admin = await createAuthUser(db, ADMIN_EMAIL);
const club = await createAuthUser(db, "pickupclub@cornell.edu", { club_name: "Pickup Club" });
const alice = await createAuthUser(db, "alice-pickup@cornell.edu");
const bob = await createAuthUser(db, "bob-pickup@cornell.edu");

await asUser(db, admin, () => db.query(`select public.admin_set_club_approved($1, true)`, [club.id]));
await db.query(`update public.clubs set venmo = 'pickup-club', groups_enabled = true where id = $1`, [
  club.id,
]);

const { rows: locRows } = await db.query(
  `insert into public.campus_locations (name, latitude, longitude, pickup_type)
   values ('Duffield Atrium', 42.4442, -76.4823, 'both') returning id`,
);
const locationId = locRows[0].id;

const { rows: listingRows } = await db.query(
  `insert into public.listings
     (club_id, brand, title, items, contact_email, active, expires_at, pickup_info, pickup_location_id)
   values ($1, 'Crumbl', 'Pickup calendar drop',
     '[{"name":"Dozen","price":24,"quantity":12}]'::jsonb,
     'x@cornell.edu', true, $2, 'Duffield atrium, 4 to 7 pm', $3)
   returning id`,
  [club.id, future, locationId],
);
const listingId = listingRows[0].id;

// Two pickup spots with fixed timing, so the calendar button has a picker's
// worth of real options to build from.
const spotEnd = new Date(new Date(future).getTime() + 3 * 3600e3).toISOString();
await db.query(
  `insert into public.listing_pickup_spots (listing_id, location_id, order_type, available_start, available_end)
   values ($1, $2, 'preorder', $3, $4)`,
  [listingId, locationId, future, spotEnd],
);
const { rows: hoRows } = await db.query(
  `insert into public.campus_locations (name, latitude, longitude, pickup_type)
   values ('Ho Plaza', 42.4472, -76.4852, 'both') returning id`,
);
const hoPlazaId = hoRows[0].id;
const spot2Start = spotEnd;
const spot2End = new Date(new Date(spotEnd).getTime() + 3600e3).toISOString();
await db.query(
  `insert into public.listing_pickup_spots (listing_id, location_id, order_type, available_start, available_end)
   values ($1, $2, 'same_day', $3, $4)`,
  [listingId, hoPlazaId, spot2Start, spot2End],
);

async function attempt(fn) {
  try {
    return { ok: true, value: await fn() };
  } catch (err) {
    return { ok: false, message: String(err.message ?? err) };
  }
}

const createGroup = await attempt(() =>
  asUser(db, alice, async () => {
    const { rows } = await db.query(
      `select public.create_order_group($1, 'Dozen', 2, '{}', 'public', $2) as res`,
      [listingId, ACK],
    );
    return rows[0].res;
  }),
);
check("group creates", createGroup.ok, createGroup.ok ? "" : createGroup.message);
const groupId = createGroup.value?.group_id;
const openToken = createGroup.value?.open_token;

const myGroups = await asUser(db, alice, async () => {
  const { rows } = await db.query(`select * from public.get_my_groups()`);
  return rows.map((row) => row.get_my_groups);
});
const mine = myGroups.find((g) => g.id === groupId);
check("get_my_groups carries pickup_info", mine?.pickup_info === "Duffield atrium, 4 to 7 pm", mine?.pickup_info);
check(
  "get_my_groups carries expires_at",
  mine?.expires_at && new Date(mine.expires_at).getTime() === new Date(future).getTime(),
  mine?.expires_at,
);
check("get_my_groups carries location_name", mine?.location_name === "Duffield Atrium", mine?.location_name);
check(
  "get_my_groups carries both pickup spots, with real timing",
  Array.isArray(mine?.pickup_spots) &&
    mine.pickup_spots.length === 2 &&
    mine.pickup_spots[0].location_name === "Duffield Atrium" &&
    mine.pickup_spots[0].order_type === "preorder" &&
    new Date(mine.pickup_spots[0].available_start).getTime() === new Date(future).getTime() &&
    mine.pickup_spots[1].location_name === "Ho Plaza" &&
    Number(mine.pickup_spots[1].latitude) === 42.4472,
  JSON.stringify(mine?.pickup_spots),
);

const clubGroups = await asUser(db, club, async () => {
  const { rows } = await db.query(`select * from public.get_club_groups()`);
  return rows.map((row) => row.get_club_groups);
});
const clubView = clubGroups.find((g) => g.id === groupId);
check("get_club_groups carries the same three fields", clubView?.pickup_info && clubView?.expires_at && clubView?.location_name);

const invites = await asUser(db, bob, async () => {
  const { rows } = await db.query(`select * from public.get_my_group_invites()`);
  return rows.map((row) => row.get_my_group_invites);
});
void invites; // no email invite was sent in this test; the public-token path below covers get_group_by_token

const tokenView = await attempt(() =>
  db.query(`select public.get_group_by_token($1) as p`, [openToken]).then((r) => r.rows[0].p),
);
check("get_group_by_token (anon-reachable) also carries the new fields", tokenView.ok, tokenView.ok ? "" : tokenView.message);
check(
  "...pickup_info",
  tokenView.value?.pickup_info === "Duffield atrium, 4 to 7 pm",
  tokenView.value?.pickup_info,
);
check(
  "...still strips payment fields from members (051)",
  tokenView.value?.members?.every((m) => !("payment_method" in m) && !("payment_handle" in m)),
);

const denied = await attempt(() => asUser(db, alice, () => db.query(`select public.group_payload($1)`, [groupId])));
check("group_payload itself stays non-callable by clients (052)", !denied.ok, denied.ok ? "was callable" : "");

// ===================== Solo order: get_my_orders (057) =====================
const orderId = await attempt(() =>
  asUser(db, bob, async () => {
    const { rows } = await db.query(
      `select public.create_order($1, 'Bob Test', 'bob-pickup@cornell.edu', 'bob123',
         '[{"name":"Dozen","qty":1}]'::jsonb, 'venmo', 'bob-venmo') as id`,
      [listingId],
    );
    return rows[0].id;
  }),
);
check("solo order creates", orderId.ok, orderId.ok ? "" : orderId.message);

const myOrders = await asUser(db, bob, async () => {
  const { rows } = await db.query(`select * from public.get_my_orders()`);
  return rows.map((row) => row.get_my_orders);
});
const myOrder = myOrders.find((o) => o.id === orderId.value);
check(
  "get_my_orders (057) carries both pickup spots too",
  Array.isArray(myOrder?.pickup_spots) &&
    myOrder.pickup_spots.length === 2 &&
    myOrder.pickup_spots[1].order_type === "same_day",
  JSON.stringify(myOrder?.pickup_spots),
);

// pickup_slots' public-read policy (002) is what /week and the club form's
// conflict warning rely on; confirm it still holds after 056.
const slotEnd = new Date(new Date(future).getTime() + 3600e3).toISOString();
const { rows: slotRows } = await db.query(
  `insert into public.pickup_slots (listing_id, start_time, end_time, max_reservations, location_id)
   values ($1, $2, $3, 20, $4) returning id`,
  [listingId, future, slotEnd, locationId],
);
const publicRead = await attempt(() => db.query(`select * from public.pickup_slots where id = $1`, [slotRows[0].id]));
const asAnon = await attempt(() => asUser(db, null, () => db.query(`select * from public.pickup_slots where id = $1`, [slotRows[0].id])));
check("pickup_slots stays publicly readable", publicRead.ok && asAnon.ok && asAnon.value.rows.length === 1);

summary();
