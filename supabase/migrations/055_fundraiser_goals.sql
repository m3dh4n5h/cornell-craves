-- Cornell Craves 055: optional fundraiser goal per drop.
--
-- The goal label reuses listings.cause_name ("Raising for: ORIE club trip"),
-- so the only new column is the dollar target. A goal needs a cause name.
--
-- Raised = money the club has confirmed receiving for this drop:
--   * solo orders with payment_verified = true (not cancelled), full total;
--   * split members marked 'paid' (043/051 per-member verification), one share
--     each, item_price / total_people (the same share club_dashboard_stats
--     uses for revenue), skipping groups that were canceled.
-- It is the full amount paid, not scaled by cause_percent.
--
-- Public read: listing_fundraising(uuid[]) returns only listing id, goal and
-- raised total. No order rows, names or emails. Same visibility as the
-- listings SELECT policy (active, own club, or admin).
--
-- Idempotent: safe to re-run.

alter table public.listings add column if not exists goal_amount numeric(10, 2);

alter table public.listings drop constraint if exists listings_goal_amount_valid;
alter table public.listings
  add constraint listings_goal_amount_valid check (
    goal_amount is null
    or (
      goal_amount > 0
      and goal_amount <= 1000000
      and nullif(btrim(coalesce(cause_name, '')), '') is not null
    )
  );

create or replace function public.listing_fundraising(p_listing_ids uuid[])
returns table (listing_id uuid, goal numeric, raised numeric)
language sql
stable
security definer
set search_path = public
as $$
  select
    l.id,
    l.goal_amount,
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
    )
  from public.listings l
  where l.id = any ((coalesce(p_listing_ids, '{}'::uuid[]))[1:200])
    and (l.active or l.club_id = auth.uid() or public.is_admin())
    and l.goal_amount is not null;
$$;

revoke execute on function public.listing_fundraising(uuid[]) from public;
grant execute on function public.listing_fundraising(uuid[]) to anon, authenticated;
