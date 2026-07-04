-- Cornell Craves 041: platform insights for the admin dashboard.
-- One SECURITY DEFINER RPC (guarded by is_admin()) returns everything the
-- Insights tab renders: a 30-day revenue/orders trend, the top-selling items
-- platform-wide, a peak-order-time heatmap, and buyer-loyalty counts. Times
-- are bucketed in America/New_York so the charts match campus reality.

create or replace function public.admin_insights()
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  select case when public.is_admin() then jsonb_build_object(
    -- Verified solo revenue + paid group shares, per Ithaca-local day.
    'daily', (
      select coalesce(
        jsonb_agg(jsonb_build_object('day', d.day, 'revenue', d.revenue, 'orders', d.orders) order by d.day),
        '[]'::jsonb
      )
      from (
        select day, sum(revenue) as revenue, sum(orders) as orders
        from (
          select to_char(o.created_at at time zone 'America/New_York', 'YYYY-MM-DD') as day,
                 sum(o.total) as revenue,
                 count(*) as orders
          from public.orders o
          where o.payment_verified and o.created_at >= now() - interval '30 days'
          group by 1
          union all
          select to_char(g.created_at at time zone 'America/New_York', 'YYYY-MM-DD'),
                 sum(g.item_price / greatest(g.total_people, 1)),
                 count(*)
          from public.order_group_members m
          join public.order_groups g on g.id = m.group_id
          where m.status = 'paid' and g.created_at >= now() - interval '30 days'
          group by 1
        ) u
        group by day
      ) d
    ),
    -- What students actually buy, across every club (last 30 days).
    'top_items', (
      select coalesce(
        jsonb_agg(jsonb_build_object('name', t.name, 'units', t.units, 'revenue', t.revenue) order by t.units desc),
        '[]'::jsonb
      )
      from (
        select line->>'name' as name,
               sum(coalesce((line->>'qty')::numeric, 0)) as units,
               sum(coalesce((line->>'qty')::numeric, 0) * coalesce((line->>'price')::numeric, 0)) as revenue
        from public.orders o
        cross join lateral jsonb_array_elements(o.items_json) as line
        where o.payment_verified and o.created_at >= now() - interval '30 days'
        group by 1
        order by 2 desc
        limit 10
      ) t
    ),
    -- When students order: Monday-first day-of-week x hour, Ithaca time.
    'heatmap', (
      select coalesce(
        jsonb_agg(jsonb_build_object('dow', h.dow, 'hour', h.hour, 'orders', h.orders)),
        '[]'::jsonb
      )
      from (
        select extract(isodow from o.created_at at time zone 'America/New_York')::int - 1 as dow,
               extract(hour from o.created_at at time zone 'America/New_York')::int as hour,
               count(*) as orders
        from public.orders o
        where o.payment_verified and o.created_at >= now() - interval '30 days'
        group by 1, 2
      ) h
    ),
    'buyers_total', (
      select count(distinct lower(orderer_email)) from public.orders where payment_verified
    ),
    'buyers_repeat', (
      select count(*) from (
        select 1 from public.orders
        where payment_verified
        group by lower(orderer_email)
        having count(*) >= 2
      ) r
    ),
    'buyers_new_30d', (
      select count(*) from (
        select lower(orderer_email) as email, min(created_at) as first_order
        from public.orders
        where payment_verified
        group by 1
      ) f
      where f.first_order >= now() - interval '30 days'
    ),
    'students_new_30d', (
      select count(*) from public.users_extended
      where created_at >= now() - interval '30 days'
    ),
    'avg_order_value_30d', (
      select coalesce(avg(total), 0) from public.orders
      where payment_verified and created_at >= now() - interval '30 days'
    )
  ) else null end;
$$;

revoke execute on function public.admin_insights() from public, anon;
grant execute on function public.admin_insights() to authenticated;
