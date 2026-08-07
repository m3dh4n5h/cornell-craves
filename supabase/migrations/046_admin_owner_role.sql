-- Cornell Craves 046: one owner, many admins.
--
-- Migration 042 made the admin list a runtime table (`admin_emails`) instead of
-- a hard-coded email. This adds the missing half: a single OWNER who can grant
-- and take away admin access from inside the /admin console, and ordinary
-- admins who can do everything else but cannot touch the admin list.
--
-- Powers:
--   owner  - everything an admin can do, PLUS add / suspend / reactivate /
--            remove admins.
--   admin  - approve clubs, decide brand requests, revoke brand grants, hide
--            and restore listings, read insights. Cannot see or change the
--            admin roster; `admin_list_admins()` refuses them outright.
--
-- Run AFTER 042_admin_email_registry.sql. Idempotent: safe to re-run.
--
-- ============================ ACTION REQUIRED ============================
-- This migration cannot know your email (that is the whole point of 042), so it
-- promotes nobody. After running it, make yourself the owner ONCE in the SQL
-- editor. This line is intentionally NOT in the migration so your address never
-- lands in git:
--
--   insert into public.admin_emails (email, role, status)
--   values (lower('you@example.com'), 'owner', 'active')
--   on conflict (email) do update set role = 'owner', status = 'active';
--
-- Until you run that, there is no owner: the Admins tab stays hidden and every
-- management function refuses everyone. That is the safe failure mode - it can
-- never hand the admin list to the wrong person, it just does nothing.
--
-- To transfer ownership later, demote the old owner in the same editor
-- (`update public.admin_emails set role = 'admin' where ...`) and then promote
-- the new one. Ownership is deliberately not transferable from the UI: a single
-- misclick should not be able to lock you out of your own platform.
-- ========================================================================

-- ===================== Columns =====================

alter table public.admin_emails
  add column if not exists role text not null default 'admin'
  check (role in ('owner', 'admin'));

-- Suspended keeps the row (and its history) while removing every power. Use it
-- instead of delete when someone steps away but may come back.
alter table public.admin_emails
  add column if not exists status text not null default 'active'
  check (status in ('active', 'suspended'));

-- Optional human label so the roster is readable ("Priya, ops lead").
alter table public.admin_emails
  add column if not exists label text;

alter table public.admin_emails
  add column if not exists added_by text;

alter table public.admin_emails
  add column if not exists status_changed_at timestamptz;

alter table public.admin_emails
  add column if not exists status_changed_by text;

-- Every lookup below matches on lower(email), so fold any hand-seeded row that
-- was typed with capitals BEFORE adding the index that depends on it.
update public.admin_emails
set email = lower(email)
where email <> lower(email);

-- Without this, 'You@example.com' and 'you@example.com' are two separate rows
-- and a suspend would only catch one of them.
create unique index if not exists admin_emails_email_lower_key
  on public.admin_emails (lower(email));

-- Exactly one owner, enforced by the database rather than by hoping the UI is
-- correct. A second `update ... set role = 'owner'` fails loudly.
create unique index if not exists admin_emails_single_owner
  on public.admin_emails (role)
  where role = 'owner';

comment on table public.admin_emails is
  'Admin roster. Unreadable to clients (RLS on, no policies); reachable only through the SECURITY DEFINER functions below.';

-- ===================== Identity helpers =====================

/**
 * Now status-aware: suspending someone revokes every admin power immediately,
 * everywhere, because every RLS policy in the schema routes through this.
 * Still fails closed on an empty JWT email.
 */
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
        and status = 'active'
    );
$$;

/** True only for the single active owner row. */
create or replace function public.is_owner()
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
        and role = 'owner'
        and status = 'active'
    );
$$;

revoke execute on function public.is_admin() from anon;
grant execute on function public.is_admin() to authenticated;
revoke execute on function public.is_owner() from anon;
grant execute on function public.is_owner() to authenticated;

/** Client-facing boolean, mirroring the existing am_i_admin(). */
create or replace function public.am_i_owner()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select public.is_owner();
$$;

revoke execute on function public.am_i_owner() from public, anon;
grant execute on function public.am_i_owner() to authenticated;

-- ===================== Roster management (owner only) =====================

/**
 * The roster. Owner only - a regular admin gets an exception rather than an
 * empty list, so a UI bug can never quietly leak the list of privileged
 * addresses.
 */
create or replace function public.admin_list_admins()
returns table (
  email text,
  label text,
  role text,
  status text,
  added_by text,
  created_at timestamptz,
  status_changed_at timestamptz,
  status_changed_by text
)
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if not public.is_owner() then
    raise exception 'Only the owner can view the admin roster'
      using errcode = '42501';
  end if;

  return query
    select a.email, a.label, a.role, a.status, a.added_by,
           a.created_at, a.status_changed_at, a.status_changed_by
    from public.admin_emails a
    -- Owner pinned to the top, then newest first.
    order by (a.role = 'owner') desc, a.created_at desc;
end;
$$;

/**
 * Add an admin, active immediately.
 *
 * Guards: owner only; basic email shape; never creates or overwrites an owner;
 * re-adding a suspended address reactivates it rather than erroring, which is
 * the behaviour you actually want when someone comes back.
 */
create or replace function public.admin_add_admin(p_email text, p_label text default null)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_email text := lower(btrim(coalesce(p_email, '')));
  v_actor text := lower(coalesce(auth.jwt() ->> 'email', ''));
  v_existing_role text;
begin
  if not public.is_owner() then
    raise exception 'Only the owner can add admins' using errcode = '42501';
  end if;

  if v_email !~ '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$' then
    raise exception 'That does not look like an email address' using errcode = '22023';
  end if;

  select role into v_existing_role
  from public.admin_emails
  where lower(email) = v_email;

  -- Refuse to rewrite the owner row through the ordinary add path.
  if v_existing_role = 'owner' then
    raise exception 'That address is the owner and cannot be changed here'
      using errcode = '42501';
  end if;

  -- Explicit update-or-insert rather than ON CONFLICT: the uniqueness that
  -- matters here is on lower(email), not on the raw primary key, and spelling
  -- that out is clearer than an expression conflict target.
  if v_existing_role is not null then
    update public.admin_emails
    set status = 'active',
        role = 'admin',
        -- Qualified: an unqualified `label` here would be ambiguous against the
        -- column being assigned.
        label = coalesce(nullif(btrim(coalesce(p_label, '')), ''), admin_emails.label),
        status_changed_at = now(),
        status_changed_by = v_actor
    where lower(email) = v_email;
  else
    insert into public.admin_emails (email, label, role, status, added_by,
                                     status_changed_at, status_changed_by)
    values (v_email, nullif(btrim(coalesce(p_label, '')), ''), 'admin', 'active',
            v_actor, now(), v_actor);
  end if;
end;
$$;

/**
 * Suspend or reactivate. Suspension takes effect on the suspended person's very
 * next request, because is_admin() reads status live rather than trusting a
 * token claim.
 */
create or replace function public.admin_set_admin_status(p_email text, p_status text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_email text := lower(btrim(coalesce(p_email, '')));
  v_actor text := lower(coalesce(auth.jwt() ->> 'email', ''));
  v_role text;
begin
  if not public.is_owner() then
    raise exception 'Only the owner can change admin status' using errcode = '42501';
  end if;

  if p_status not in ('active', 'suspended') then
    raise exception 'Status must be active or suspended' using errcode = '22023';
  end if;

  select role into v_role from public.admin_emails where lower(email) = v_email;

  if v_role is null then
    raise exception 'No admin with that address' using errcode = '02000';
  end if;

  -- Two ways to lock yourself out, both closed here.
  if v_role = 'owner' then
    raise exception 'The owner cannot be suspended' using errcode = '42501';
  end if;
  if v_email = v_actor then
    raise exception 'You cannot change your own admin status' using errcode = '42501';
  end if;

  update public.admin_emails
  set status = p_status,
      status_changed_at = now(),
      status_changed_by = v_actor
  where lower(email) = v_email;
end;
$$;

/** Remove an admin entirely. The owner row is not removable. */
create or replace function public.admin_remove_admin(p_email text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_email text := lower(btrim(coalesce(p_email, '')));
  v_actor text := lower(coalesce(auth.jwt() ->> 'email', ''));
  v_role text;
begin
  if not public.is_owner() then
    raise exception 'Only the owner can remove admins' using errcode = '42501';
  end if;

  select role into v_role from public.admin_emails where lower(email) = v_email;

  if v_role is null then
    return; -- Already gone. Removing twice is not an error.
  end if;
  if v_role = 'owner' then
    raise exception 'The owner cannot be removed' using errcode = '42501';
  end if;
  if v_email = v_actor then
    raise exception 'You cannot remove yourself' using errcode = '42501';
  end if;

  delete from public.admin_emails where lower(email) = v_email;
end;
$$;

revoke execute on function public.admin_list_admins() from public, anon;
grant execute on function public.admin_list_admins() to authenticated;
revoke execute on function public.admin_add_admin(text, text) from public, anon;
grant execute on function public.admin_add_admin(text, text) to authenticated;
revoke execute on function public.admin_set_admin_status(text, text) from public, anon;
grant execute on function public.admin_set_admin_status(text, text) to authenticated;
revoke execute on function public.admin_remove_admin(text) from public, anon;
grant execute on function public.admin_remove_admin(text) to authenticated;
