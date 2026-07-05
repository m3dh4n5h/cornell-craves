-- Cornell Craves 042: move admin identity OUT of the codebase.
--
-- Until now is_admin() hard-coded the admin's personal email as a SQL literal,
-- so it lived in the repo (and its git history). This migration makes the admin
-- list a runtime table you seed by hand, exactly like you already apply
-- migrations by hand. Nothing about who-is-admin ships in git anymore.
--
-- ============================ ACTION REQUIRED ============================
-- After running this file, seed your admin email ONCE in the SQL editor (this
-- line is intentionally NOT in the migration so it never gets committed):
--
--   insert into public.admin_emails (email) values ('you@example.com')
--   on conflict (email) do nothing;
--
-- If you skip this, is_admin() returns false for everyone (fails closed / safe)
-- and the /admin panel will be empty until you seed a row.
-- ========================================================================

create table if not exists public.admin_emails (
  email text primary key,
  created_at timestamptz not null default now()
);

-- RLS on with NO policy: the table is unreadable to anon/authenticated. Only the
-- SECURITY DEFINER is_admin() below (owned by postgres) can read it, so the
-- admin address is never exposed to a client query.
alter table public.admin_emails enable row level security;

-- SECURITY DEFINER so it bypasses the table's RLS to check membership. The
-- explicit search_path prevents a hijacked path from resolving admin_emails to
-- an attacker-controlled table. Fails closed: an empty JWT email never matches.
create or replace function public.is_admin()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(auth.jwt() ->> 'email', '') <> ''
    and exists (
      select 1 from public.admin_emails
      where lower(email) = lower(auth.jwt() ->> 'email')
    );
$$;

-- is_admin() has always been callable by authenticated users (it reveals only a
-- boolean about the caller). create-or-replace keeps existing grants; re-assert
-- the safe posture explicitly.
revoke execute on function public.is_admin() from anon;
grant execute on function public.is_admin() to authenticated;
