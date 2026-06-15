-- Cornell Craves: "which member recommended you?" capture (Tranche 4 #2).
--
-- A club keeps a list of member names; a listing can opt in to showing the
-- recommender dropdown on its order form; the chosen value is stored on the
-- order. To avoid touching the audited create_order RPC, the order form calls
-- create_order then a separate set_order_recommender RPC.

alter table public.clubs
  add column if not exists member_options text[] not null default '{}';

alter table public.listings
  add column if not exists recommender_enabled boolean not null default false;

alter table public.orders
  add column if not exists recommended_by text;

-- Sets orders.recommended_by, but only when the order belongs to the caller and
-- its listing has the recommender enabled. A blank value clears the field; a
-- non-blank value must match one of the club's member_options.
create or replace function public.set_order_recommender(p_order_id uuid, p_value text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_order public.orders%rowtype;
  v_enabled boolean;
  v_options text[];
  v_value text := nullif(btrim(coalesce(p_value, '')), '');
begin
  select * into v_order from public.orders where id = p_order_id;
  if not found then
    raise exception 'Order not found';
  end if;
  if v_order.user_id is null or v_order.user_id <> auth.uid() then
    raise exception 'You can only set the recommender on your own order';
  end if;

  select l.recommender_enabled, c.member_options
    into v_enabled, v_options
  from public.listings l
  join public.clubs c on c.id = l.club_id
  where l.id = v_order.listing_id;

  if not coalesce(v_enabled, false) then
    raise exception 'This listing is not asking for a recommender';
  end if;

  if v_value is not null and not (v_value = any (coalesce(v_options, '{}'))) then
    raise exception 'That recommender is not on the club''s list';
  end if;

  update public.orders set recommended_by = v_value where id = p_order_id;
end;
$$;

revoke execute on function public.set_order_recommender(uuid, text) from public, anon;
grant execute on function public.set_order_recommender(uuid, text) to authenticated;
