-- Cornell Craves 045: remember who has already seen which walkthrough.
--
-- The app ships three simulated tutorials (student, club, admin). Each one is
-- offered ONCE, automatically, the first time an account of that role lands on
-- the app, and can be replayed forever from /about, the club dashboard, the
-- admin console, and account settings.
--
-- Why a table instead of columns on users_extended / clubs:
--   * the admin has no users_extended row and no clubs row, so there is no
--     existing place to hang an admin flag;
--   * one account can legitimately see two tours (the admin is also a student);
--   * bumping TOUR_VERSION in the client re-offers a tour to everyone without
--     a schema change, because the version travels with the row.
--
-- Standalone and idempotent: it depends on nothing from 041-044 and is safe to
-- re-run. Cascade-deletes with the auth user, so delete_my_account() needs no
-- change.

create table if not exists public.tour_progress (
  user_id uuid not null references auth.users (id) on delete cascade,
  -- Which walkthrough. Kept as a checked text so adding a fourth tour later is
  -- a one-line alter instead of an enum migration.
  tour_key text not null check (tour_key in ('student', 'club', 'admin')),
  -- 'completed' = reached the last step. 'skipped' = bailed out early. Both
  -- stop the auto-offer; the difference is only for our own curiosity.
  status text not null default 'completed' check (status in ('completed', 'skipped')),
  -- Zero-based index of the step they were on when the row was written.
  last_step integer not null default 0 check (last_step >= 0),
  -- Client-side TOUR_VERSION. Bump it to re-offer the tour to everyone.
  version text not null default 'v1',
  seen_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (user_id, tour_key)
);

comment on table public.tour_progress is
  'One row per (user, walkthrough). Presence of a row suppresses the first-run auto-offer.';

-- Owner-only, no exceptions: this is per-person UI state, not admin-auditable
-- data, so is_admin() is deliberately NOT in these policies.
alter table public.tour_progress enable row level security;

drop policy if exists "Users read their own tour progress" on public.tour_progress;
create policy "Users read their own tour progress"
  on public.tour_progress for select
  using (auth.uid() = user_id);

drop policy if exists "Users record their own tour progress" on public.tour_progress;
create policy "Users record their own tour progress"
  on public.tour_progress for insert
  with check (auth.uid() = user_id);

drop policy if exists "Users update their own tour progress" on public.tour_progress;
create policy "Users update their own tour progress"
  on public.tour_progress for update
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

drop policy if exists "Users clear their own tour progress" on public.tour_progress;
create policy "Users clear their own tour progress"
  on public.tour_progress for delete
  using (auth.uid() = user_id);

-- Anonymous visitors can browse /about and replay a tutorial, but nothing is
-- persisted for them (the client falls back to localStorage).
revoke all on public.tour_progress from anon;
grant select, insert, update, delete on public.tour_progress to authenticated;

-- Keep updated_at honest even when the client forgets to send it.
create or replace function public.touch_tour_progress()
returns trigger
language plpgsql
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

drop trigger if exists tour_progress_touch on public.tour_progress;
create trigger tour_progress_touch
  before update on public.tour_progress
  for each row execute function public.touch_tour_progress();
