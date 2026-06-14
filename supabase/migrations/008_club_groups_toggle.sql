-- Cornell Craves: per-club group-ordering toggle (Feature B).
-- Run AFTER 007_account_management.sql.

alter table public.clubs
  add column if not exists groups_enabled boolean not null default true;

-- create_order_group now refuses when the owning club has disabled group
-- ordering. The frontend also hides the split option, but this is the
-- authoritative enforcement (anon could still call the RPC directly).
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
  v_group_id uuid;
  v_open_token text := public.generate_invite_token();
  v_email text;
begin
  if auth.uid() is null then
    raise exception 'Sign in with Google to start a split order';
  end if;
  if p_split_type < 2 or p_split_type > 4 then
    raise exception 'Split between 2 and 4 people';
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

  insert into public.order_groups (
    listing_id, item_name, item_price, split_type, total_people,
    filled_count, deadline, created_by
  )
  values (
    p_listing_id, p_item_name, v_price, p_split_type, p_split_type,
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

-- Grants unchanged (create or replace preserves them), but restate for clarity.
revoke execute on function public.create_order_group(uuid, text, int, text[]) from public, anon;
grant execute on function public.create_order_group(uuid, text, int, text[]) to authenticated;
