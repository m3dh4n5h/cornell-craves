-- Cornell Craves v2: marketplace features.
-- Pickup scheduling + reservations, reviews, Q&A, recurring templates,
-- analytics events, campus pickup locations.
-- Run AFTER 001_init.sql.

-- ===================== Campus locations =====================

create table public.campus_locations (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  latitude decimal(10, 8) not null,
  longitude decimal(11, 8) not null,
  description text,
  created_at timestamptz not null default now()
);

insert into public.campus_locations (name, latitude, longitude, description) values
  ('Ho Plaza', 42.44740, -76.48530, 'Center of campus, between the Straight and Sage Chapel'),
  ('Duffield Hall atrium', 42.44455, -76.48280, 'Engineering quad, indoor atrium'),
  ('Willard Straight Hall lobby', 42.44660, -76.48560, 'Main lobby, next to the Browsing Library'),
  ('Klarman Hall atrium', 42.44900, -76.48370, 'Arts quad, glass atrium behind Goldwin Smith'),
  ('Mann Library steps', 42.44870, -76.47640, 'Ag quad, front entrance'),
  ('Olin Library entrance', 42.44770, -76.48450, 'Arts quad, under the overhang'),
  ('RPCC lobby', 42.45620, -76.47780, 'North campus, Robert Purcell Community Center'),
  ('Noyes Community Center', 42.44680, -76.48870, 'West campus, main entrance'),
  ('Statler Hall front', 42.44560, -76.48190, 'East Ave entrance, by the auditorium'),
  ('Engineering quad sundial', 42.44440, -76.48390, 'Outdoor, between Duffield and Olin Hall');

-- ===================== Listings additions =====================

alter table public.listings add column pickup_location_id uuid references public.campus_locations (id) on delete set null;
alter table public.listings add column avg_rating decimal(2, 1) not null default 0;
alter table public.listings add column review_count int not null default 0;

-- ===================== Pickup slots + reservations =====================

create table public.pickup_slots (
  id uuid primary key default gen_random_uuid(),
  listing_id uuid not null references public.listings (id) on delete cascade,
  start_time timestamptz not null,
  end_time timestamptz not null,
  max_reservations int not null check (max_reservations >= 1),
  reserved_count int not null default 0 check (reserved_count >= 0),
  created_at timestamptz not null default now(),
  check (end_time > start_time),
  check (reserved_count <= max_reservations)
);

create table public.reservations (
  id uuid primary key default gen_random_uuid(),
  slot_id uuid not null references public.pickup_slots (id) on delete cascade,
  user_email text not null,
  user_name text not null,
  quantity int not null check (quantity >= 1 and quantity <= 20),
  dietary_notes text,
  confirmed boolean not null default false,
  attended boolean not null default false,
  created_at timestamptz not null default now(),
  unique (slot_id, user_email)
);

create index pickup_slots_listing_idx on public.pickup_slots (listing_id, start_time);
create index reservations_slot_idx on public.reservations (slot_id);
create index reservations_email_idx on public.reservations (lower(user_email));

-- ===================== Reviews =====================

create table public.reviews (
  id uuid primary key default gen_random_uuid(),
  listing_id uuid not null references public.listings (id) on delete cascade,
  reviewer_email text not null,
  reviewer_name text not null,
  rating int not null check (rating >= 1 and rating <= 5),
  title text not null check (char_length(title) between 1 and 120),
  body text not null check (char_length(body) between 1 and 2000),
  club_response text,
  response_date timestamptz,
  helpful_count int not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (listing_id, reviewer_email)
);

create index reviews_listing_idx on public.reviews (listing_id, created_at desc);

-- Keep the denormalized rating on listings in sync.
create or replace function public.refresh_listing_rating()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_listing uuid := coalesce(new.listing_id, old.listing_id);
begin
  update public.listings
  set avg_rating = coalesce((select round(avg(rating)::numeric, 1) from public.reviews where listing_id = v_listing), 0),
      review_count = (select count(*) from public.reviews where listing_id = v_listing)
  where id = v_listing;
  return coalesce(new, old);
end;
$$;

create trigger reviews_refresh_rating
  after insert or update or delete on public.reviews
  for each row execute function public.refresh_listing_rating();

-- Review content is immutable once posted. Updates may only touch the club
-- response and helpful count (helpful votes come through an RPC).
create or replace function public.protect_review_fields()
returns trigger
language plpgsql
as $$
begin
  if new.listing_id is distinct from old.listing_id
    or new.reviewer_email is distinct from old.reviewer_email
    or new.reviewer_name is distinct from old.reviewer_name
    or new.rating is distinct from old.rating
    or new.title is distinct from old.title
    or new.body is distinct from old.body
    or new.created_at is distinct from old.created_at
  then
    raise exception 'Review content cannot be edited';
  end if;
  new.updated_at = now();
  return new;
end;
$$;

create trigger reviews_protect_fields
  before update on public.reviews
  for each row execute function public.protect_review_fields();

-- ===================== Q&A =====================

create table public.qa (
  id uuid primary key default gen_random_uuid(),
  listing_id uuid not null references public.listings (id) on delete cascade,
  question_email text not null, -- SHA-256 hash, computed client-side for anonymity
  question text not null check (char_length(question) between 1 and 500),
  club_response text,
  response_date timestamptz,
  helpful_count int not null default 0,
  created_at timestamptz not null default now()
);

create index qa_listing_idx on public.qa (listing_id, created_at desc);

create or replace function public.protect_qa_fields()
returns trigger
language plpgsql
as $$
begin
  if new.listing_id is distinct from old.listing_id
    or new.question_email is distinct from old.question_email
    or new.question is distinct from old.question
    or new.created_at is distinct from old.created_at
  then
    raise exception 'Question content cannot be edited';
  end if;
  return new;
end;
$$;

create trigger qa_protect_fields
  before update on public.qa
  for each row execute function public.protect_qa_fields();

-- ===================== Recurring templates =====================

create table public.recurring_templates (
  id uuid primary key default gen_random_uuid(),
  club_id uuid not null references public.clubs (id) on delete cascade,
  name text not null,
  brand text not null,
  items jsonb not null default '[]'::jsonb,
  description text,
  frequency text not null check (frequency in ('weekly', 'biweekly', 'monthly')),
  next_run_date date,
  is_active boolean not null default true,
  created_at timestamptz not null default now()
);

create index templates_club_idx on public.recurring_templates (club_id);

-- ===================== Analytics =====================

-- Event log: one row per view / Venmo click. The charts (daily trend, CTR,
-- peak-hours heatmap) need event-level timestamps, which a counters table
-- cannot provide. club_analytics below is a view over this log.
create table public.analytics_events (
  id uuid primary key default gen_random_uuid(),
  listing_id uuid not null references public.listings (id) on delete cascade,
  club_id uuid not null references public.clubs (id) on delete cascade,
  event_type text not null check (event_type in ('view', 'venmo_click')),
  created_at timestamptz not null default now()
);

create index analytics_events_club_idx on public.analytics_events (club_id, created_at);
create index analytics_events_listing_idx on public.analytics_events (listing_id);

create view public.club_analytics
with (security_invoker = true) as
select
  l.club_id,
  l.id as listing_id,
  count(e.id) filter (where e.event_type = 'view') as views,
  count(e.id) filter (where e.event_type = 'venmo_click') as venmo_clicks,
  (select count(*) from public.qa q where q.listing_id = l.id) as qa_count,
  coalesce(
    (select round(avg(s.reserved_count::numeric / s.max_reservations), 2)
     from public.pickup_slots s where s.listing_id = l.id),
    0
  ) as reservation_rate,
  l.avg_rating,
  now() as updated_at
from public.listings l
left join public.analytics_events e on e.listing_id = l.id
group by l.club_id, l.id, l.avg_rating;

-- ===================== RPC functions =====================
-- All security definer: they do narrow, validated writes that anonymous
-- students must be able to perform without broad RLS policies.

create or replace function public.track_event(p_listing_id uuid, p_event_type text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_club uuid;
begin
  if p_event_type not in ('view', 'venmo_click') then
    raise exception 'Unknown event type';
  end if;
  select club_id into v_club from public.listings where id = p_listing_id;
  if v_club is null then
    return;
  end if;
  insert into public.analytics_events (listing_id, club_id, event_type)
  values (p_listing_id, v_club, p_event_type);
end;
$$;

create or replace function public.create_reservation(
  p_slot_id uuid,
  p_email text,
  p_name text,
  p_quantity int,
  p_dietary_notes text default null
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_slot public.pickup_slots%rowtype;
  v_active boolean;
  v_id uuid;
begin
  if p_quantity < 1 or p_quantity > 20 then
    raise exception 'Quantity must be between 1 and 20';
  end if;
  if trim(coalesce(p_email, '')) = '' or trim(coalesce(p_name, '')) = '' then
    raise exception 'Name and email are required';
  end if;

  select * into v_slot from public.pickup_slots where id = p_slot_id for update;
  if not found then
    raise exception 'Pickup slot not found';
  end if;
  if v_slot.start_time <= now() then
    raise exception 'This pickup window has already started';
  end if;
  if v_slot.reserved_count >= v_slot.max_reservations then
    raise exception 'This slot is full';
  end if;

  select active into v_active from public.listings where id = v_slot.listing_id;
  if not coalesce(v_active, false) then
    raise exception 'This listing is no longer active';
  end if;

  begin
    insert into public.reservations (slot_id, user_email, user_name, quantity, dietary_notes)
    values (
      p_slot_id,
      lower(trim(p_email)),
      trim(p_name),
      p_quantity,
      nullif(trim(coalesce(p_dietary_notes, '')), '')
    )
    returning id into v_id;
  exception
    when unique_violation then
      raise exception 'You already have a reservation for this slot';
  end;

  update public.pickup_slots set reserved_count = reserved_count + 1 where id = p_slot_id;
  return v_id;
end;
$$;

create or replace function public.cancel_reservation(p_reservation_id uuid, p_email text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_slot uuid;
begin
  delete from public.reservations
  where id = p_reservation_id and lower(user_email) = lower(trim(p_email))
  returning slot_id into v_slot;
  if v_slot is null then
    raise exception 'Reservation not found';
  end if;
  update public.pickup_slots
  set reserved_count = greatest(reserved_count - 1, 0)
  where id = v_slot;
end;
$$;

create or replace function public.confirm_reservation(p_reservation_id uuid, p_email text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_updated int;
begin
  update public.reservations r
  set confirmed = true
  from public.pickup_slots s
  where r.id = p_reservation_id
    and lower(r.user_email) = lower(trim(p_email))
    and s.id = r.slot_id
    and s.start_time > now()
    and s.start_time <= now() + interval '24 hours';
  get diagnostics v_updated = row_count;
  if v_updated = 0 then
    raise exception 'Attendance can only be confirmed in the 24 hours before pickup';
  end if;
end;
$$;

create or replace function public.get_my_reservations(p_email text)
returns table (
  id uuid,
  quantity int,
  dietary_notes text,
  confirmed boolean,
  attended boolean,
  created_at timestamptz,
  slot_id uuid,
  start_time timestamptz,
  end_time timestamptz,
  listing_id uuid,
  listing_title text,
  brand text,
  listing_active boolean,
  location_name text,
  club_name text,
  venmo text,
  zelle_phone text
)
language sql
security definer
set search_path = public
as $$
  select
    r.id, r.quantity, r.dietary_notes, r.confirmed, r.attended, r.created_at,
    s.id, s.start_time, s.end_time,
    l.id, l.title, l.brand, l.active,
    cl.name, c.name, c.venmo, c.zelle_phone
  from public.reservations r
  join public.pickup_slots s on s.id = r.slot_id
  join public.listings l on l.id = s.listing_id
  join public.clubs c on c.id = l.club_id
  left join public.campus_locations cl on cl.id = l.pickup_location_id
  where lower(r.user_email) = lower(trim(p_email))
  order by s.start_time asc;
$$;

create or replace function public.vote_review_helpful(p_review_id uuid)
returns void
language sql
security definer
set search_path = public
as $$
  update public.reviews set helpful_count = helpful_count + 1 where id = p_review_id;
$$;

create or replace function public.vote_qa_helpful(p_qa_id uuid)
returns void
language sql
security definer
set search_path = public
as $$
  update public.qa set helpful_count = helpful_count + 1 where id = p_qa_id;
$$;

grant execute on function public.track_event(uuid, text) to anon, authenticated;
grant execute on function public.create_reservation(uuid, text, text, int, text) to anon, authenticated;
grant execute on function public.cancel_reservation(uuid, text) to anon, authenticated;
grant execute on function public.confirm_reservation(uuid, text) to anon, authenticated;
grant execute on function public.get_my_reservations(text) to anon, authenticated;
grant execute on function public.vote_review_helpful(uuid) to anon, authenticated;
grant execute on function public.vote_qa_helpful(uuid) to anon, authenticated;

-- ===================== Row level security =====================

alter table public.campus_locations enable row level security;
alter table public.pickup_slots enable row level security;
alter table public.reservations enable row level security;
alter table public.reviews enable row level security;
alter table public.qa enable row level security;
alter table public.recurring_templates enable row level security;
alter table public.analytics_events enable row level security;

-- campus_locations: public read, admin write.
create policy "Locations are public"
  on public.campus_locations for select
  using (true);

create policy "Admin manages locations"
  on public.campus_locations for all
  using (public.is_admin())
  with check (public.is_admin());

-- pickup_slots: public read (the calendar), owning club writes.
create policy "Slots are public"
  on public.pickup_slots for select
  using (true);

create policy "Clubs manage slots for their listings"
  on public.pickup_slots for all
  using (exists (select 1 from public.listings l where l.id = listing_id and l.club_id = auth.uid()))
  with check (exists (select 1 from public.listings l where l.id = listing_id and l.club_id = auth.uid()));

-- reservations: created/cancelled only via the RPCs above. The owning club
-- can read and update them (mark attended) for its reservation manager.
create policy "Clubs see reservations for their listings"
  on public.reservations for select
  using (
    exists (
      select 1 from public.pickup_slots s
      join public.listings l on l.id = s.listing_id
      where s.id = slot_id and l.club_id = auth.uid()
    )
  );

create policy "Clubs update reservations for their listings"
  on public.reservations for update
  using (
    exists (
      select 1 from public.pickup_slots s
      join public.listings l on l.id = s.listing_id
      where s.id = slot_id and l.club_id = auth.uid()
    )
  )
  with check (
    exists (
      select 1 from public.pickup_slots s
      join public.listings l on l.id = s.listing_id
      where s.id = slot_id and l.club_id = auth.uid()
    )
  );

-- reviews: public read and write; the protect trigger plus the unique
-- constraint keep content immutable and one review per email per listing.
-- Updates (club responses) are limited to the owning club.
create policy "Reviews are public"
  on public.reviews for select
  using (true);

create policy "Anyone can post a review"
  on public.reviews for insert
  with check (true);

create policy "Clubs respond to reviews on their listings"
  on public.reviews for update
  using (exists (select 1 from public.listings l where l.id = listing_id and l.club_id = auth.uid()))
  with check (exists (select 1 from public.listings l where l.id = listing_id and l.club_id = auth.uid()));

-- qa: same model as reviews.
create policy "Questions are public"
  on public.qa for select
  using (true);

create policy "Anyone can ask a question"
  on public.qa for insert
  with check (true);

create policy "Clubs respond to questions on their listings"
  on public.qa for update
  using (exists (select 1 from public.listings l where l.id = listing_id and l.club_id = auth.uid()))
  with check (exists (select 1 from public.listings l where l.id = listing_id and l.club_id = auth.uid()));

-- recurring_templates: private to the owning club.
create policy "Clubs manage their own templates"
  on public.recurring_templates for all
  using (club_id = auth.uid())
  with check (club_id = auth.uid());

-- analytics_events: inserted via track_event(); readable by the owning club.
create policy "Clubs read their own analytics events"
  on public.analytics_events for select
  using (club_id = auth.uid() or public.is_admin());
