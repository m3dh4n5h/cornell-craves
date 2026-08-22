# Database workflow tests

Runs every migration on a throwaway in-memory Postgres (PGlite) with a stubbed
Supabase `auth`/`storage` layer, then simulates real users driving the brand
approval workflow: clubs saving drafts and autoposts, the admin approving
once / deploying to all / rejecting / renaming / revoking, RLS enforcement,
expired-listing edge cases, and the moderation + stats RPCs.

These are the 28 scenarios that caught (and now guard against) the
"approve once did nothing next time" bug fixed in migration 040.

## Run

```bash
npm i --no-save @electric-sql/pglite   # one time; not a project dependency
node supabase/tests/simulate.mjs       # expect: 28 passed, 0 failed
node supabase/tests/split-edge.mjs     # expect: 96 passed, 0 failed
node supabase/tests/admin-roles.mjs    # expect: 41 passed, 0 failed
node supabase/tests/split-attack.mjs   # expect: 41 passed, 0 failed
node supabase/tests/split-lifecycle.mjs # expect: 126 passed, 0 failed
```

Every statement in the simulation mirrors an actual client call (same columns,
same RPCs as `Dashboard.tsx`, `ClubTemplates.tsx`, and `Admin.tsx`), so if a
future migration breaks the workflow this fails before production does.

`split-edge.mjs` covers the group split feature end to end: creation guards
(divisor-only sizes, the club's groups toggle, quantity snapshots), join and
invitation edge cases, per-member payment declarations, QR pass + pickup-code
gating ("nothing unlocks until the WHOLE group is verified", no leaks through
the public invite-token payload), the split recommender, and public-group
matching. It guards the regression migration 021 introduced and 043 fixed.

It also covers the migration-044 deadline model and acknowledgments: a full
group owes nothing until its order deadline passes (then a 24h payment window
opens); the hourly job (`process_group_deadlines`) opens payment, cancels
groups that never fill, and cancels unpaid groups past their window; the club
controls (`club_extend_deadlines`, `open_group_payment`, `reactivate_group`,
with per-group and per-listing scope and ownership checks); the student rules
acknowledgment required on every create/join; and the club acknowledgment
required to enable the feature.

`admin-roles.mjs` covers the owner / multi-admin roster from migration 046: that
seeding no owner leaves the roster unmanageable by anyone (the safe failure
mode), that exactly one owner can exist, that an ordinary admin keeps every
platform power but is refused the roster outright, that the owner cannot suspend
or remove themselves, that suspension revokes `is_admin()` — and therefore every
RLS policy that depends on it — on the very next request, and that addresses are
matched case- and whitespace-insensitively so `Ops@Example.com ` and
`ops@example.com` can never become two rows.

`split-attack.mjs` is the adversarial counterpart to `split-edge.mjs`: every
check is written from the attacker's side, so a PASS means the attack was
blocked. It reproduces the seven gaps closed by migration 052 — chiefly that
`order_groups` used to be directly writable by its creator (who could flip their
own group to `paid` and release their own QR pass while a co-member still owed
money, or reprice the group to $0.01 on the club's dashboard), and that
`group_payload()` kept Postgres's default PUBLIC execute grant so a signed-out
caller could enumerate every group and read every member's Venmo/Zelle handle,
bypassing 051 entirely. It also pins the things that must keep WORKING:
the anon invite preview still resolves, an invitee can still decline their own
invitation, a filled group can still be reactivated for payment on a closed
drop, and inviting a couple of friends is unaffected by the fan-out cap.

`split-lifecycle.mjs` walks a group all the way through every path it can take -
happy path to pickup, never fills, fills but someone never pays, club closes
ordering early, club extends either deadline, both flavours of reactivation -
and asserts the notification side as well as the rows.

Emails matter here because SPLIT_RULES (`src/lib/groups.ts`) is mostly a set of
promises about *being told*: "we will email you", "you will have 24 hours",
"you will get another email with a fresh deadline". A transition that changes
state and tells nobody breaks the rules students agreed to even when every row
is correct. Nothing in SQL sends mail, so the suite installs triggers at the two
points Supabase fires the webhook from (`order_groups` UPDATE and
`order_group_invitations` INSERT), mirrors `handleGroupStatusChange`'s branch
table in JS, and asserts the resulting recipients, subjects and cancellation
variant (refund-owed vs never-charged) at each step. Two guards keep that mirror
honest: S1 greps `notify-cravings/index.ts` for every branch the mirror claims,
and S13 fails if the run produced a status transition that neither emails nor
appears on an explicit "silent by design" list.

It also pins migration 053: the club sees its split members' email and NetID,
while `get_my_groups` (a co-member) and the anon invite preview do not.

The last section (S14) checks the rules students formally accept
(`SPLIT_RULES` / `CLUB_SPLIT_RULES`) against the behaviour the scenarios above
just proved — that a cancelled-then-reactivated group does not refund an
already-paid share, that the club really does receive contact details, that
co-members really can see each other's payment handles, and that email sending
really is best-effort. An overstated rule is a representation the project then
fails to honour, so editing the rules without the behaviour (or the reverse)
fails here.

Every guard is asserted against the database rather than the UI, because
`AdminRoster.tsx` only hides buttons; `is_owner()` is what actually stops
someone calling the RPC by hand.
