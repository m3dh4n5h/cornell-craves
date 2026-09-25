-- Cornell Craves 059: fundraising goals are private to the club.
--
-- 055 stored goal_amount on listings, which every visitor can read, and
-- required a cause before a goal could be set. A goal is the club's own
-- internal target, not a donation to an outside organization, and privacy is
-- the default:
--
--   * Goals move to their own table, listing_goals, readable and writable only
--     by the club that owns the drop (and admins can read). No anon access and
--     no access for other students, so the target amount never leaves the club.
--   * goal_public (default false) is the club's switch. Only when it is on does
--     listing_fundraising return the goal and the raised total to students.
--   * The goal no longer needs a cause. A drop can have a goal, a cause, both,
--     or neither.
--   * listings.goal_amount is copied over and then dropped.
--
-- Raised is unchanged from 055: verified, non-cancelled solo orders plus one
-- share per paid split member of a non-canceled group.
--
-- Run AFTER 058. Idempotent: safe to re-run.

create table if not exists public.listing_goals (
  listing_id  uuid primary key references public.listings (id) on delete cascade,
  goal_amount numeric(10, 2) not null check (goal_amount > 0 and goal_amount <= 1000000),
  goal_public boolean not null default false,
  updated_at  timestamptz not null default now()
);

alter table public.listing_goals enable row level security;

-- Copy any goals saved under 055 (and the brief listings.goal_public column,
-- if it was ever applied), then drop them from the public listings table.
do $$
begin
  if exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'listings' and column_name = 'goal_amount'
  ) then
    if exists (
      select 1 from information_schema.columns
      where table_schema = 'public' and table_name = 'listings' and column_name = 'goal_public'
    ) then
      execute $sql$
        insert into public.listing_goals (listing_id, goal_amount, goal_public)
        select id, goal_amount, coalesce(goal_public, false)
        from public.listings
        where goal_amount is not null and goal_amount > 0 and goal_amount <= 1000000
        on conflict (listing_id) do nothing
      $sql$;
    else
      execute $sql$
        insert into public.listing_goals (listing_id, goal_amount)
        select id, goal_amount
        from public.listings
        where goal_amount is not null and goal_amount > 0 and goal_amount <= 1000000
        on conflict (listing_id) do nothing
      $sql$;
    end if;
  end if;
end;
$$;

alter table public.listings drop constraint if exists listings_goal_amount_valid;
alter table public.listings drop column if exists goal_public;
alter table public.listings drop column if exists goal_amount;

-- Only the owning club (and admins, read-only) can touch a goal.
drop policy if exists "listing_goals_select_own" on public.listing_goals;
create policy "listing_goals_select_own" on public.listing_goals
  for select to authenticated
  using (
    exists (select 1 from public.listings l where l.id = listing_id and l.club_id = auth.uid())
    or public.is_admin()
  );

drop policy if exists "listing_goals_insert_own" on public.listing_goals;
create policy "listing_goals_insert_own" on public.listing_goals
  for insert to authenticated
  with check (
    exists (select 1 from public.listings l where l.id = listing_id and l.club_id = auth.uid())
  );

drop policy if exists "listing_goals_update_own" on public.listing_goals;
create policy "listing_goals_update_own" on public.listing_goals
  for update to authenticated
  using (
    exists (select 1 from public.listings l where l.id = listing_id and l.club_id = auth.uid())
  )
  with check (
    exists (select 1 from public.listings l where l.id = listing_id and l.club_id = auth.uid())
  );

drop policy if exists "listing_goals_delete_own" on public.listing_goals;
create policy "listing_goals_delete_own" on public.listing_goals
  for delete to authenticated
  using (
    exists (select 1 from public.listings l where l.id = listing_id and l.club_id = auth.uid())
  );

revoke all on public.listing_goals from anon, public;
grant select, insert, update, delete on public.listing_goals to authenticated;

-- Aggregates only. Students get a row only for an active drop whose club made
-- the goal public; the owning club and admins always get theirs.
drop function if exists public.listing_fundraising(uuid[]);
create function public.listing_fundraising(p_listing_ids uuid[])
returns table (listing_id uuid, goal numeric, raised numeric, is_public boolean)
language sql
stable
security definer
set search_path = public
as $$
  select
    l.id,
    lg.goal_amount,
    round(
      coalesce((
        select sum(o.total)
        from public.orders o
        where o.listing_id = l.id
          and o.payment_verified
          and o.status <> 'cancelled'
      ), 0)
      + coalesce((
        select sum(g.item_price / greatest(g.total_people, 1))
        from public.order_group_members m
        join public.order_groups g on g.id = m.group_id
        where g.listing_id = l.id
          and g.status <> 'canceled'
          and m.status = 'paid'
      ), 0),
      2
    ),
    lg.goal_public
  from public.listings l
  join public.listing_goals lg on lg.listing_id = l.id
  where l.id = any ((coalesce(p_listing_ids, '{}'::uuid[]))[1:200])
    and ((l.active and lg.goal_public) or l.club_id = auth.uid() or public.is_admin());
$$;

revoke execute on function public.listing_fundraising(uuid[]) from public;
grant execute on function public.listing_fundraising(uuid[]) to anon, authenticated;
