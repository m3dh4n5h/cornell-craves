-- Cornell Craves: item quantities + equal-division group splits (Feature C).
-- Run AFTER 008_club_groups_toggle.sql.
--
-- Item `quantity` (units in a box, e.g. a dozen = 12) lives in the existing
-- listings.items JSONB, so no listings column change is needed. A splittable
-- item must divide evenly: only group sizes that are divisors of the quantity
-- (and >= 2) are allowed, and each member gets quantity / N whole units.

-- order_groups previously capped split sizes at 4. Divisors of a box can be
-- larger (12 -> 2,3,4,6,12), so loosen the checks.
alter table public.order_groups drop constraint if exists order_groups_split_type_check;
alter table public.order_groups drop constraint if exists order_groups_total_people_check;
alter table public.order_groups add constraint order_groups_split_type_check check (split_type >= 2 and split_type <= 50);
alter table public.order_groups add constraint order_groups_total_people_check check (total_people >= 2 and total_people <= 50);

-- Snapshot the item's box quantity on the group so per-person units render
-- stably even if the listing later changes.
alter table public.order_groups
  add column if not exists item_quantity int not null default 1;

-- group_payload now exposes item_quantity (via to_jsonb(g)) plus the derived
-- per-person unit count.
create or replace function public.group_payload(p_group_id uuid)
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  select to_jsonb(g)
    || jsonb_build_object(
      'listing_title', l.title,
      'brand', l.brand,
      'listing_active', l.active,
      'club_name', c.name,
      'club_venmo', c.venmo,
      'club_zelle', c.zelle_phone,
      'share_amount', round(g.item_price / greatest(g.total_people, 1), 2),
      'units_per_person', floor(greatest(g.item_quantity, 1) / greatest(g.total_people, 1)),
      'open_token', (
        select i.invite_link_token from public.order_group_invitations i
        where i.group_id = g.id and i.invited_email is null
        limit 1
      ),
      'members', coalesce(
        (
          select jsonb_agg(
            jsonb_build_object(
              'id', m.id,
              'user_id', m.user_id,
              'name',
                case
                  when coalesce(u.first_name, '') = '' then 'Student'
                  else u.first_name || case when coalesce(u.last_name, '') = '' then '' else ' ' || left(u.last_name, 1) end
                end,
              'status', m.status,
              'scanned_at', m.scanned_at,
              'is_creator', m.user_id = g.created_by
            )
            order by m.created_at
          )
          from public.order_group_members m
          left join public.users_extended u on u.id = m.user_id
          where m.group_id = g.id
        ),
        '[]'::jsonb
      )
    )
  from public.order_groups g
  join public.listings l on l.id = g.listing_id
  join public.clubs c on c.id = l.club_id
  where g.id = p_group_id;
$$;

-- Final authoritative create_order_group: enforces the groups toggle (Feature B)
-- AND even division (Feature C). A non-divisible split is rejected here, not just
-- hidden in the UI.
create or replace function public.create_order_group(
  p_listing_id uuid,
  p_item_name text,
  p_split_type int,
  p_invited_emails text[] default '{}'
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_listing public.listings%rowtype;
  v_groups_enabled boolean;
  v_item jsonb;
  v_price numeric;
  v_qty int;
  v_group_id uuid;
  v_open_token text := public.generate_invite_token();
  v_email text;
begin
  if auth.uid() is null then
    raise exception 'Sign in with Google to start a split order';
  end if;
  if p_split_type < 2 then
    raise exception 'Split with at least 2 people';
  end if;

  select * into v_listing from public.listings where id = p_listing_id;
  if not found or not v_listing.active or v_listing.expires_at <= now() then
    raise exception 'This listing is not taking orders';
  end if;

  select groups_enabled into v_groups_enabled from public.clubs where id = v_listing.club_id;
  if not coalesce(v_groups_enabled, true) then
    raise exception 'This club has turned off group ordering';
  end if;

  select item into v_item
  from jsonb_array_elements(v_listing.items) as item
  where item ->> 'name' = p_item_name
  limit 1;
  if v_item is null then
    raise exception 'Unknown item: %', p_item_name;
  end if;
  v_price := coalesce(nullif(v_item ->> 'price', '')::numeric, 0);
  v_qty := greatest(coalesce(nullif(v_item ->> 'quantity', '')::int, 1), 1);

  if v_qty % p_split_type <> 0 then
    raise exception '% (% in a box) cannot be split evenly % ways', p_item_name, v_qty, p_split_type;
  end if;

  insert into public.order_groups (
    listing_id, item_name, item_price, item_quantity, split_type, total_people,
    filled_count, deadline, created_by
  )
  values (
    p_listing_id, p_item_name, v_price, v_qty, p_split_type, p_split_type,
    1, now() + interval '48 hours', auth.uid()
  )
  returning id into v_group_id;

  insert into public.order_group_members (group_id, user_id, status)
  values (v_group_id, auth.uid(), 'accepted');

  insert into public.order_group_invitations (group_id, invited_email, invited_by_user_id, invite_link_token)
  values (v_group_id, null, auth.uid(), v_open_token);

  foreach v_email in array coalesce(p_invited_emails, '{}') loop
    if trim(v_email) <> '' then
      insert into public.order_group_invitations (group_id, invited_email, invited_by_user_id, invite_link_token)
      values (v_group_id, lower(trim(v_email)), auth.uid(), public.generate_invite_token());
    end if;
  end loop;

  return jsonb_build_object('group_id', v_group_id, 'open_token', v_open_token);
end;
$$;

revoke execute on function public.create_order_group(uuid, text, int, text[]) from public, anon;
grant execute on function public.create_order_group(uuid, text, int, text[]) to authenticated;
