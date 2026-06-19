-- Cornell Craves post-038 hardening:
--   1. Re-affirm is_admin() to the real admin email. An earlier run of 036 may
--      have applied the old placeholder/Cornell address to the database, which
--      would leave the admin unrecognized. Idempotent.
--   2. Drop the legacy helpful-vote RPCs (migration 002). They were superseded
--      by the per-user, sign-in-gated toggle_qa_helpful / toggle_review_helpful
--      in migration 036, are not called by the client, yet remained executable
--      by anon - letting anyone inflate helpful counts. Remove them.

create or replace function public.is_admin()
returns boolean
language sql
stable
as $$
  select lower(coalesce(auth.jwt() ->> 'email', '')) = lower('medhansh.bhagchandani@gmail.com');
$$;

drop function if exists public.vote_review_helpful(uuid);
drop function if exists public.vote_qa_helpful(uuid);
