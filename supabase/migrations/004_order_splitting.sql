-- Cornell Craves v4: order splitting (group orders).
-- Run AFTER 003_orders.sql.

-- ===================== Tables =====================

create table public.order_groups (
  id uuid primary key default gen_random_uuid(),
  listing_id uuid not null references public.listings (id) on delete cascade,
  -- Items live as jsonb on listings, so groups reference the item by name and
  -- snapshot its price at creation time.
  item_name text not null,
  item_price numeric(8, 2) not null check (item_price >= 0),
  split_type int not null check (split_type between 1 and 4),
  total_people int not null check (total_people between 1 and 4),
  filled_count int not null default 0 check (filled_count >= 0),
  deadline timestamptz not null,
  status text not null default 'filling'
    check (status in ('filling', 'full', 'payment_in_progress', 'paid', 'canceled', 'reactivated')),
  created_by uuid not null references auth.users (id) on delete cascade,
  created_at timestamptz not null default now(),
  check (filled_count <= total_people)
);

create table public.order_group_members (
  id uuid primary key default gen_random_uuid(),
  group_id uuid not null references public.order_groups (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  status text not null default 'accepted'
    check (status in ('invited', 'accepted', 'pending_payment', 'paid')),
  qr_encrypted text not null default '',
  scanned_at timestamptz,
  created_at timestamptz not null default now(),
  unique (group_id, user_id)
);

create table public.order_group_invitations (
  id uuid primary key default gen_random_uuid(),
  group_id uuid not null references public.order_groups (id) on delete cascade,
  -- null email = the open share link anyone can use until the group fills.
  invited_email text,
  invited_by_user_id uuid not null references auth.users (id) on delete cascade,
  status text not null default 'pending' check (status in ('pending', 'accepted', 'declined')),
  invite_link_token text not null unique,
  created_at timestamptz not null default now()
);

create index order_groups_listing_idx on public.order_groups (listing_id, status);
create index order_groups_deadline_idx on public.order_groups (status, deadline);
create index group_members_user_idx on public.order_group_members (user_id);
create index group_invites_email_idx on public.order_group_invitations (lower(invited_email));

-- ===================== Helpers =====================

create or replace function public.generate_invite_token()
returns text
language sql
volatile
as $$
  select replace(gen_random_uuid()::text, '-', '') || replace(gen_random_uuid()::text, '-', '');
$$;

-- Group context as the frontend consumes it, with member first names only.
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

-- ===================== RPC functions =====================

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

  -- The open share link.
  insert into public.order_group_invitations (group_id, invited_email, invited_by_user_id, invite_link_token)
  values (v_group_id, null, auth.uid(), v_open_token);

  -- Targeted email invites, each with its own token (emailed via webhook).
  foreach v_email in array coalesce(p_invited_emails, '{}') loop
    if trim(v_email) <> '' then
      insert into public.order_group_invitations (group_id, invited_email, invited_by_user_id, invite_link_token)
      values (v_group_id, lower(trim(v_email)), auth.uid(), public.generate_invite_token());
    end if;
  end loop;

  return jsonb_build_object('group_id', v_group_id, 'open_token', v_open_token);
end;
$$;

create or replace function public.accept_group_invite(p_token text)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_invite public.order_group_invitations%rowtype;
  v_group public.order_groups%rowtype;
begin
  if auth.uid() is null then
    raise exception 'Sign in with Google to join a split order';
  end if;

  select * into v_invite from public.order_group_invitations
  where invite_link_token = trim(p_token);
  if not found or v_invite.status = 'declined' then
    raise exception 'This invite link is not valid';
  end if;

  select * into v_group from public.order_groups where id = v_invite.group_id for update;
  if v_group.status not in ('filling') then
    raise exception 'This group is no longer accepting members';
  end if;
  if exists (select 1 from public.order_group_members where group_id = v_group.id and user_id = auth.uid()) then
    return v_group.id; -- already in, idempotent
  end if;
  if v_group.filled_count >= v_group.total_people then
    raise exception 'This group is already full';
  end if;

  insert into public.order_group_members (group_id, user_id, status)
  values (v_group.id, auth.uid(), 'accepted');

  -- Personal invites are consumed; the open link stays live until full.
  if v_invite.invited_email is not null then
    update public.order_group_invitations set status = 'accepted' where id = v_invite.id;
  end if;

  if v_group.filled_count + 1 >= v_group.total_people then
    update public.order_groups
    set filled_count = filled_count + 1,
        status = 'full',
        deadline = now() + interval '24 hours'
    where id = v_group.id;
    update public.order_group_members
    set status = 'pending_payment'
    where group_id = v_group.id and status in ('accepted', 'invited');
  else
    update public.order_groups set filled_count = filled_count + 1 where id = v_group.id;
  end if;

  return v_group.id;
end;
$$;

create or replace function public.decline_group_invite(p_token text)
returns void
language sql
security definer
set search_path = public
as $$
  update public.order_group_invitations
  set status = 'declined'
  where invite_link_token = trim(p_token) and invited_email is not null and status = 'pending';
$$;

create or replace function public.get_group_by_token(p_token text)
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  select public.group_payload(i.group_id) || jsonb_build_object('invite_status', i.status)
  from public.order_group_invitations i
  where i.invite_link_token = trim(p_token);
$$;

create or replace function public.get_my_groups()
returns setof jsonb
language sql
stable
security definer
set search_path = public
as $$
  select public.group_payload(m.group_id)
    || jsonb_build_object('my_status', m.status, 'my_member_id', m.id, 'my_qr', m.qr_encrypted)
  from public.order_group_members m
  join public.order_groups g on g.id = m.group_id
  where m.user_id = auth.uid()
  order by g.created_at desc;
$$;

create or replace function public.get_my_group_invites()
returns setof jsonb
language sql
stable
security definer
set search_path = public
as $$
  select public.group_payload(i.group_id)
    || jsonb_build_object('invite_token', i.invite_link_token)
  from public.order_group_invitations i
  where i.status = 'pending'
    and i.invited_email is not null
    and lower(i.invited_email) in (
      select lower(coalesce(u.cornell_email, '')) from public.users_extended u where u.id = auth.uid()
      union
      select lower(coalesce(au.email, '')) from auth.users au where au.id = auth.uid()
    )
    and not exists (
      select 1 from public.order_group_members m
      where m.group_id = i.group_id and m.user_id = auth.uid()
    )
  order by i.created_at desc;
$$;

create or replace function public.get_club_groups()
returns setof jsonb
language sql
stable
security definer
set search_path = public
as $$
  select public.group_payload(g.id)
  from public.order_groups g
  join public.listings l on l.id = g.listing_id
  where l.club_id = auth.uid()
  order by g.created_at desc;
$$;

grant execute on function public.create_order_group(uuid, text, int, text[]) to authenticated;
grant execute on function public.accept_group_invite(text) to authenticated;
grant execute on function public.decline_group_invite(text) to authenticated;
grant execute on function public.get_group_by_token(text) to anon, authenticated;
grant execute on function public.get_my_groups() to authenticated;
grant execute on function public.get_my_group_invites() to authenticated;
grant execute on function public.get_club_groups() to authenticated;

-- ===================== Row level security =====================

alter table public.order_groups enable row level security;
alter table public.order_group_members enable row level security;
alter table public.order_group_invitations enable row level security;

-- Groups are publicly readable (the invite page shows them pre-auth); writes
-- go through the RPCs and the edge function.
create policy "Groups are public"
  on public.order_groups for select
  using (true);

create policy "Signed-in users create groups"
  on public.order_groups for insert
  with check (created_by = auth.uid());

create policy "Creators and clubs update groups"
  on public.order_groups for update
  using (
    created_by = auth.uid()
    or exists (select 1 from public.listings l where l.id = listing_id and l.club_id = auth.uid())
  )
  with check (
    created_by = auth.uid()
    or exists (select 1 from public.listings l where l.id = listing_id and l.club_id = auth.uid())
  );

-- Members: visible to fellow members, the creator, and the listing's club.
create policy "Members see their groups"
  on public.order_group_members for select
  using (
    user_id = auth.uid()
    or exists (
      select 1 from public.order_groups g
      where g.id = group_id
        and (
          g.created_by = auth.uid()
          or exists (select 1 from public.listings l where l.id = g.listing_id and l.club_id = auth.uid())
        )
    )
  );

-- Invitations: inviter sees what they sent; recipients read via RPC (email
-- matching needs auth.users, which RLS cannot join).
create policy "Inviters see their invitations"
  on public.order_group_invitations for select
  using (invited_by_user_id = auth.uid());
