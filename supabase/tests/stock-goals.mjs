// Item stock caps (054) and fundraiser goals (055).
// Runs every migration on in-memory Postgres, then drives the same RPCs and
// table writes OrderForm.tsx, Dashboard.tsx and ClubOrders.tsx use.
//
//   npm i --no-save @electric-sql/pglite   # one time
//   node supabase/tests/stock-goals.mjs
//
// PGlite is a single connection, so true concurrency cannot be exercised here.
// The race guard is the listing row lock (SELECT ... FOR UPDATE) the triggers
// take before counting; the suite asserts that lock is in place.
import { boot, asUser, createAuthUser, check, summary } from "./harness.mjs";

const db = await boot();
console.log("Booted with all migrations\n");

const future = new Date(Date.now() + 48 * 3600e3).toISOString();
const ACK = "test-rules-v1";

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
const club = await createAuthUser(db, "stockclub@cornell.edu", { club_name: "Stock Club" });
const alice = await createAuthUser(db, "alice9@cornell.edu");
const bob = await createAuthUser(db, "bob9@cornell.edu");
const cara = await createAuthUser(db, "cara9@cornell.edu");
await asUser(db, admin, () => db.query(`select public.admin_set_club_approved($1, true)`, [club.id]));
await db.query(`update public.clubs set venmo = 'stock-club', groups_enabled = true where id = $1`, [
  club.id,
]);

async function seedListing(title, items, extra = {}) {
  const { rows } = await db.query(
    `insert into public.listings (club_id, brand, title, items, contact_email, active, expires_at, cause_name, cause_percent, goal_amount)
     values ($1, 'Crumbl', $2, $3::jsonb, 'x@cornell.edu', $4, $5, $6, $7, $8) returning id`,
    [
      club.id,
      title,
      JSON.stringify(items),
      extra.active ?? true,
      future,
      extra.cause ?? null,
      extra.cause ? 100 : null,
      extra.goal ?? null,
    ],
  );
  return rows[0].id;
}

const order = (user, listingId, items) =>
  asUser(db, user, async () => {
    const { rows } = await db.query(
      `select public.create_order($1, 'Student', $2, 'abc123', $3::jsonb, 'venmo', 'stu-venmo') as id`,
      [listingId, user.email, JSON.stringify(items)],
    );
    return rows[0].id;
  });
const stock = async (user, listingId) =>
  asUser(db, user, async () => {
    const { rows } = await db.query(`select * from public.listing_stock($1)`, [[listingId]]);
    return Object.fromEntries(rows.map((r) => [r.item_name, r]));
  });
const fundraising = async (user, listingId) =>
  asUser(db, user, async () => {
    const { rows } = await db.query(`select * from public.listing_fundraising($1)`, [[listingId]]);
    return rows[0] ?? null;
  });

// ===================== Stock shape validation =====================
console.log("Stock shape");
const shapeListing = await seedListing("Shape drop", [{ name: "Box", price: 10 }]);
for (const [label, bad] of [
  ["negative", -1],
  ["fractional", 2.5],
  ["string", "40"],
  ["too large", 100001],
]) {
  const res = await attempt(() =>
    asUser(db, club, () =>
      db.query(`update public.listings set items = $2::jsonb where id = $1`, [
        shapeListing,
        JSON.stringify([{ name: "Box", price: 10, stock: bad }]),
      ]),
    ),
  );
  check(`stock rejects ${label} value`, !res.ok, res.ok ? "was accepted" : "");
}
const okShape = await attempt(() =>
  asUser(db, club, () =>
    db.query(`update public.listings set items = $2::jsonb where id = $1`, [
      shapeListing,
      JSON.stringify([{ name: "Box", price: 10, stock: 40 }, { name: "Loose", price: 2, stock: null }]),
    ]),
  ),
);
check("club can set a whole-number stock (and null) on its own drop", okShape.ok, okShape.message);

// ===================== Solo orders =====================
console.log("\nSolo orders");
const soloListing = await seedListing("Solo drop", [
  { name: "Box", price: 10, stock: 3 },
  { name: "Cookie", price: 4 },
]);

let s = await stock(null, soloListing);
check("anon sees remaining for capped items only", s.Box?.remaining === 3 && !s.Cookie, JSON.stringify(s));
check(
  "listing_stock returns counts only",
  Object.keys(s.Box ?? {}).sort().join(",") === "item_name,listing_id,remaining,stock",
  Object.keys(s.Box ?? {}).join(","),
);

const o1 = await attempt(() => order(alice, soloListing, [{ name: "Box", qty: 2 }]));
check("order within stock succeeds", o1.ok, o1.message);
s = await stock(null, soloListing);
check("remaining drops to 1", s.Box.remaining === 1, `got ${s.Box.remaining}`);

let res = await attempt(() => order(bob, soloListing, [{ name: "Box", qty: 2 }]));
check(
  "order over remaining is rejected with a clear message",
  !res.ok && /Only 1 left of Box/.test(res.message),
  res.message ?? "was accepted",
);
const bobOrders = await db.query(`select count(*)::int as n from public.orders where user_id = $1`, [bob.id]);
check("rejected order leaves no row behind", bobOrders.rows[0].n === 0);

res = await attempt(() => order(bob, soloListing, [{ name: "Cookie", qty: 30 }]));
check("uncapped item on the same drop is unaffected", res.ok, res.message);

const o2 = await attempt(() => order(bob, soloListing, [{ name: "Box", qty: 1 }]));
check("last unit can be ordered", o2.ok, o2.message);
res = await attempt(() => order(cara, soloListing, [{ name: "Box", qty: 1 }]));
check("sold-out item is rejected", !res.ok && /Box is sold out/.test(res.message), res.message ?? "was accepted");

// Verified / picked-up orders still hold stock.
await asUser(db, club, () =>
  db.query(`update public.orders set payment_verified = true, status = 'qr_sent' where id = $1`, [o1.value]),
);
s = await stock(null, soloListing);
check("a verified order still holds its units", s.Box.remaining === 0, `got ${s.Box.remaining}`);

// Cancelling releases.
res = await attempt(() =>
  asUser(db, bob, () => db.query(`select public.cancel_order($1)`, [o2.value])),
);
check("student can cancel a pending order", res.ok, res.message);
s = await stock(null, soloListing);
check("cancelled order releases its units", s.Box.remaining === 1, `got ${s.Box.remaining}`);

const o3 = await attempt(() => order(cara, soloListing, [{ name: "Box", qty: 1 }]));
check("released unit can be ordered again", o3.ok, o3.message);

res = await attempt(() =>
  asUser(db, club, () =>
    db.query(`update public.orders set status = 'pending_payment' where id = $1`, [o2.value]),
  ),
);
check(
  "reviving a cancelled order is blocked when the stock is gone",
  !res.ok && /sold out/.test(res.message),
  res.message ?? "was allowed",
);

res = await attempt(() =>
  asUser(db, club, () =>
    db.query(`update public.orders set items_json = $2::jsonb where id = $1`, [
      o1.value,
      JSON.stringify([{ name: "Box", price: 10, qty: 5 }]),
    ]),
  ),
);
check("editing an order's quantity past the cap is blocked", !res.ok, res.ok ? "was allowed" : "");

res = await attempt(() =>
  asUser(db, club, () =>
    db.query(`update public.orders set status = 'picked_up' where id = $1`, [o1.value]),
  ),
);
check("normal status changes on a sold-out drop still work", res.ok, res.message);

// Raising the cap reopens the drop.
await asUser(db, club, () =>
  db.query(`update public.listings set items = $2::jsonb where id = $1`, [
    soloListing,
    JSON.stringify([{ name: "Box", price: 10, stock: 5 }, { name: "Cookie", price: 4 }]),
  ]),
);
s = await stock(null, soloListing);
check("raising the cap raises remaining", s.Box.remaining === 2, `got ${s.Box.remaining}`);

// ===================== Split groups =====================
console.log("\nSplit groups");
const groupListing = await seedListing("Group drop", [{ name: "Dozen", price: 24, quantity: 12, stock: 2 }]);
const createGroup = (user) =>
  asUser(db, user, async () => {
    const { rows } = await db.query(
      `select public.create_order_group($1, 'Dozen', 2, '{}', 'private', $2) as res`,
      [groupListing, ACK],
    );
    return rows[0].res;
  });

const g1 = await attempt(() => createGroup(alice));
check("first group takes one unit", g1.ok, g1.message);
s = await stock(null, groupListing);
check("a 2-way split holds exactly one unit", s.Dozen.remaining === 1, `got ${s.Dozen.remaining}`);

const g2 = await attempt(() => createGroup(bob));
check("second group takes the last unit", g2.ok, g2.message);
res = await attempt(() => createGroup(cara));
check("third group is rejected when sold out", !res.ok && /Dozen is sold out/.test(res.message), res.message ?? "was accepted");

res = await attempt(() =>
  asUser(db, cara, async () => {
    const { rows } = await db.query(
      `select public.join_or_create_public_group($1, 'Dozen', 2, $2) as res`,
      [groupListing, ACK],
    );
    return rows[0].res;
  }),
);
check("public join cannot open a new group past the cap", !res.ok && /sold out/.test(res.message), res.message ?? "was accepted");

const orderedDozen = await attempt(() => order(cara, groupListing, [{ name: "Dozen", qty: 1 }]));
check("solo orders and groups share one pool", !orderedDozen.ok, orderedDozen.ok ? "was accepted" : "");

await db.query(`update public.order_groups set status = 'canceled' where id = $1`, [g1.value.group_id]);
s = await stock(null, groupListing);
check("a canceled group releases its unit", s.Dozen.remaining === 1, `got ${s.Dozen.remaining}`);

const g3 = await attempt(() => createGroup(cara));
check("the released unit can start a new group", g3.ok, g3.message);

res = await attempt(() =>
  asUser(db, club, () => db.query(`select public.reactivate_group($1)`, [g1.value.group_id])),
);
check(
  "reactivating a canceled group is blocked when sold out",
  !res.ok && /sold out/.test(res.message),
  res.message ?? "was allowed",
);

await db.query(`update public.order_groups set status = 'canceled' where id = $1`, [g3.value.group_id]);
res = await attempt(() =>
  asUser(db, club, () => db.query(`select public.reactivate_group($1)`, [g1.value.group_id])),
);
check("reactivating works once a unit is free", res.ok, res.message);

// ===================== Visibility and privileges =====================
console.log("\nVisibility");
const hiddenListing = await seedListing("Hidden drop", [{ name: "Box", price: 10, stock: 5 }], { active: false });
s = await stock(null, hiddenListing);
check("anon gets nothing for an inactive drop", Object.keys(s).length === 0);
s = await stock(club, hiddenListing);
check("the owning club still sees its inactive drop", s.Box?.remaining === 5);

res = await attempt(() =>
  asUser(db, null, () => db.query(`select public.listing_item_held($1, 'Box')`, [soloListing])),
);
check("internal held-count helper is not callable by anon", !res.ok);
res = await attempt(() =>
  asUser(db, alice, () => db.query(`select public.listing_item_held($1, 'Box')`, [soloListing])),
);
check("internal held-count helper is not callable by students", !res.ok);

const lockOrders = await db.query(`select pg_get_functiondef('public.enforce_order_stock()'::regprocedure) as d`);
const lockGroups = await db.query(`select pg_get_functiondef('public.enforce_group_stock()'::regprocedure) as d`);
check(
  "both triggers lock the listing row before counting",
  /for update/i.test(lockOrders.rows[0].d) && /for update/i.test(lockGroups.rows[0].d),
);

// ===================== Fundraiser goals =====================
console.log("\nFundraiser goals");
res = await attempt(() => seedListing("Goal without cause", [{ name: "Box", price: 10 }], { goal: 500 }));
check("a goal needs a cause name", !res.ok, res.ok ? "was accepted" : "");
res = await attempt(() =>
  seedListing("Zero goal", [{ name: "Box", price: 10 }], { goal: 0, cause: "Trip" }),
);
check("a goal must be positive", !res.ok, res.ok ? "was accepted" : "");

const goalListing = await seedListing(
  "Goal drop",
  [
    { name: "Box", price: 10 },
    { name: "Dozen", price: 24, quantity: 12 },
  ],
  { goal: 100, cause: "ORIE club trip" },
);
let f = await fundraising(null, goalListing);
check("anon sees goal and zero raised", Number(f?.goal) === 100 && Number(f?.raised) === 0, JSON.stringify(f));
check(
  "listing_fundraising returns aggregates only",
  Object.keys(f ?? {}).sort().join(",") === "goal,listing_id,raised",
);

const paid1 = await order(alice, goalListing, [{ name: "Box", qty: 3 }]); // $30
const unpaid = await order(bob, goalListing, [{ name: "Box", qty: 2 }]); // $20, never verified
const refunded = await order(cara, goalListing, [{ name: "Box", qty: 1 }]); // $10, verified then cancelled
await asUser(db, club, () =>
  db.query(`update public.orders set payment_verified = true, status = 'qr_sent' where id = any($1)`, [
    [paid1, refunded],
  ]),
);
await asUser(db, club, () =>
  db.query(`update public.orders set status = 'cancelled' where id = $1`, [refunded]),
);
f = await fundraising(null, goalListing);
check("raised counts only verified, non-cancelled orders", Number(f.raised) === 30, `got ${f.raised}`);
void unpaid;

// Split: 2-way Dozen at $24 -> $12 per paid member.
const goalGroup = await asUser(db, alice, async () => {
  const { rows } = await db.query(
    `select public.create_order_group($1, 'Dozen', 2, '{}', 'private', $2) as res`,
    [goalListing, ACK],
  );
  return rows[0].res.group_id;
});
await db.query(`update public.order_group_members set status = 'paid' where group_id = $1`, [goalGroup]);
f = await fundraising(null, goalListing);
check("each paid split member adds one share", Number(f.raised) === 42, `got ${f.raised}`);

await db.query(`update public.order_groups set status = 'canceled' where id = $1`, [goalGroup]);
f = await fundraising(null, goalListing);
check("a canceled group's shares stop counting", Number(f.raised) === 30, `got ${f.raised}`);

const noGoal = await seedListing("No goal", [{ name: "Box", price: 10 }], { cause: "Pantry" });
f = await fundraising(null, noGoal);
check("drops without a goal return no row", f === null);

const hiddenGoal = await seedListing("Hidden goal", [{ name: "Box", price: 10 }], {
  goal: 50,
  cause: "Trip",
  active: false,
});
f = await fundraising(null, hiddenGoal);
check("anon gets nothing for an inactive drop's goal", f === null);

summary();
