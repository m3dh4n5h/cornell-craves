-- Cornell Craves 048: per-member "which member recommended you?" for splits.
--
-- Previously recommended_by lived only on order_groups, settable only by the
-- creator via set_group_recommender. That undercounts every real referral in
-- a split: if 3 of 4 people in a group each came from a different member's
-- link, only the creator's single pick was ever recorded.
--
-- This adds order_group_members.recommended_by so EVERY member (the creator
-- included) records their own pick, independent of everyone else's in the
-- same group. group_payload now also surfaces recommender_enabled and
-- member_options at the top level, so the join/accept screens (which never
-- see the listing directly) know whether to show the picker and what options
-- to offer.
--
-- The old order_groups.recommended_by column and set_group_recommender RPC
-- are left in place (old rows still read fine), just no longer written by
-- the app; new code should read the per-member field instead.
--
-- Run after 047_dedupe_group_invite_emails.sql. Idempotent: safe to re-run.

alter table public.order_group_members
  add column if not exists recommended_by text;

-- ===================== group_payload: expose recommender info =====================

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
  where g.id = p_group_id;
$$;

-- ===================== set_group_member_recommender =====================

-- Any member of the group can set THEIR OWN recommended_by (unlike the old
-- creator-only set_group_recommender). Same validation as
-- set_order_recommender: listing must have it enabled, and a non-blank value
-- must be one of the club's member_options. Blank clears it.
create or replace function public.set_group_member_recommender(p_group_id uuid, p_value text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_group public.order_groups%rowtype;
  v_member_id uuid;
  v_enabled boolean;
  v_options text[];
  v_value text := nullif(btrim(coalesce(p_value, '')), '');
begin
  if auth.uid() is null then
    raise exception 'Sign in to set your recommender';
  end if;

  select * into v_group from public.order_groups where id = p_group_id;
  if not found then
    raise exception 'Group not found';
  end if;

  select m.id into v_member_id
  from public.order_group_members m
  where m.group_id = p_group_id and m.user_id = auth.uid();
  if not found then
    raise exception 'You are not a member of this group';
  end if;

  select l.recommender_enabled, c.member_options
    into v_enabled, v_options
  from public.listings l
  join public.clubs c on c.id = l.club_id
  where l.id = v_group.listing_id;

  if not coalesce(v_enabled, false) then
    raise exception 'This listing is not asking for a recommender';
  end if;
  if v_value is not null and not (v_value = any (coalesce(v_options, '{}'))) then
    raise exception 'That recommender is not on the club''s list';
  end if;

  update public.order_group_members set recommended_by = v_value where id = v_member_id;
end;
$$;

revoke execute on function public.set_group_member_recommender(uuid, text) from public, anon;
grant execute on function public.set_group_member_recommender(uuid, text) to authenticated;
