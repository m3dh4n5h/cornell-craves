-- Cornell Craves 056: expose pickup_info, expires_at, the pickup location name
-- and the listing's own pickup spots (with their fixed start/end windows) on a
-- split group, matching what a solo order gets after 057.
--
-- Why: the "Add to calendar" button (client feature) needs to know when and
-- where to pick up, and a drop can offer more than one pickup point (a
-- same-day spot and a pre-order spot, say), each with its own fixed start and
-- end time (listing_pickup_spots.available_start/available_end - already the
-- club's real, entered timing, not a guess). group_payload() (048), the
-- shared helper behind get_my_groups / get_my_group_invites / get_club_groups
-- / get_group_by_token, carried none of this. Every field added here is
-- already public on the listing itself (shown on /listing/:id to anyone,
-- including anon, and the map pin popup already shows each spot's window), so
-- this is not a new exposure - it just saves every caller a second fetch of
-- data they already have RLS access to. Editing group_payload() alone is
-- enough: every wrapper RPC spreads its output (`base.payload || ...`), never
-- allowlists fields, so this reaches all four callers, get_group_by_token
-- (anon) included, without touching them.
--
-- Idempotent: safe to re-run.

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
      'pickup_info', l.pickup_info,
      'expires_at', l.expires_at,
      'location_name', cl.name,
      'pickup_spots', coalesce(
        (
          select jsonb_agg(
            jsonb_build_object(
              'order_type', s.order_type,
              'available_start', s.available_start,
              'available_end', s.available_end,
              'location_name', spot_loc.name,
              'latitude', spot_loc.latitude,
              'longitude', spot_loc.longitude
            )
            order by s.available_start nulls last
          )
          from public.listing_pickup_spots s
          join public.campus_locations spot_loc on spot_loc.id = s.location_id
          where s.listing_id = l.id
        ),
        '[]'::jsonb
      ),
      'club_name', c.name,
      'club_venmo', c.venmo,
      'club_zelle', c.zelle_phone,
      'share_amount', round(g.item_price / greatest(g.total_people, 1), 2),
      'units_per_person', floor(greatest(g.item_quantity, 1) / greatest(g.total_people, 1)),
      'recommender_enabled', coalesce(l.recommender_enabled, false),
      'member_options', coalesce(c.member_options, '{}'),
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
              'is_creator', m.user_id = g.created_by,
              'payment_method', m.payment_method,
              'payment_handle', m.payment_handle,
              'recommended_by', m.recommended_by
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
  left join public.campus_locations cl on cl.id = l.pickup_location_id
  where g.id = p_group_id;
$$;

revoke execute on function public.group_payload(uuid) from public, anon, authenticated;
