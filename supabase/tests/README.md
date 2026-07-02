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
```

Every statement in the simulation mirrors an actual client call (same columns,
same RPCs as `Dashboard.tsx`, `ClubTemplates.tsx`, and `Admin.tsx`), so if a
future migration breaks the workflow this fails before production does.
