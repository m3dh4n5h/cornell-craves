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
node supabase/tests/split-edge.mjs     # expect: 88 passed, 0 failed
node supabase/tests/admin-roles.mjs    # expect: 41 passed, 0 failed
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

Every guard is asserted against the database rather than the UI, because
`AdminRoster.tsx` only hides buttons; `is_owner()` is what actually stops
someone calling the RPC by hand.
