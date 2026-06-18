-- Cornell Craves fixes:
--   1. is_admin() still held the placeholder email, so the backend never saw the
--      admin as admin. Every is_admin()-gated read (brand requests, the admin
--      RPCs, all stats) silently returned empty. Set the real admin email and
--      compare case-insensitively. CHANGE the address below if the admin changes.
--   2. Nobody can mark their own Q&A or review helpful.
--   3. Revenue by brand for the admin dashboard.

create or replace function public.is_admin()
returns boolean
language sql
stable
as $$
  select lower(coalesce(auth.jwt() ->> 'email', '')) = lower('medhansh.bhagchandani@gmail.com');
$$;

-- Lets the admin page confirm the backend recognizes them (diagnostics).
create or replace function public.am_i_admin()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select public.is_admin();
$$;
revoke execute on function public.am_i_admin() from public, anon;
grant execute on function public.am_i_admin() to authenticated;

-- ===================== Q&A: no self-marking =====================

-- Record the asker so they can't mark their own question helpful.
alter table public.qa add column if not exists question_user_id uuid references auth.users (id) on delete set null;

create or replace function public.qa_set_author()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  new.question_user_id := auth.uid();
  return new;
end;
$$;

drop trigger if exists qa_set_author on public.qa;
create trigger qa_set_author
  before insert on public.qa
  for each row execute function public.qa_set_author();

create or replace function public.toggle_qa_helpful(p_qa_id uuid, p_target text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_exists boolean;
  v_count int;
begin
  if auth.uid() is null then
    raise exception 'Sign in to mark answers helpful';
  end if;
  if p_target not in ('question', 'answer') then
    raise exception 'Invalid helpful target';
  end if;

  -- No marking your own post helpful.
  if p_target = 'question' then
    if exists (select 1 from public.qa where id = p_qa_id and question_user_id = auth.uid()) then
      raise exception 'You cannot mark your own question helpful';
    end if;
  else
    if exists (
      select 1 from public.qa q
      join public.listings l on l.id = q.listing_id
      where q.id = p_qa_id and l.club_id = auth.uid()
    ) then
      raise exception 'You cannot mark your own answer helpful';
    end if;
  end if;

  select exists (
    select 1 from public.qa_helpful_votes
    where qa_id = p_qa_id and user_id = auth.uid() and target = p_target
  ) into v_exists;

  if v_exists then
    delete from public.qa_helpful_votes
    where qa_id = p_qa_id and user_id = auth.uid() and target = p_target;
    if p_target = 'question' then
      update public.qa set helpful_count = greatest(helpful_count - 1, 0)
      where id = p_qa_id returning helpful_count into v_count;
    else
      update public.qa set answer_helpful_count = greatest(answer_helpful_count - 1, 0)
      where id = p_qa_id returning answer_helpful_count into v_count;
    end if;
    return jsonb_build_object('voted', false, 'count', coalesce(v_count, 0));
  else
    insert into public.qa_helpful_votes (qa_id, user_id, target)
    values (p_qa_id, auth.uid(), p_target);
    if p_target = 'question' then
      update public.qa set helpful_count = helpful_count + 1
      where id = p_qa_id returning helpful_count into v_count;
    else
      update public.qa set answer_helpful_count = answer_helpful_count + 1
      where id = p_qa_id returning answer_helpful_count into v_count;
    end if;
    return jsonb_build_object('voted', true, 'count', coalesce(v_count, 0));
  end if;
end;
$$;

revoke execute on function public.toggle_qa_helpful(uuid, text) from public, anon;
grant execute on function public.toggle_qa_helpful(uuid, text) to authenticated;

-- ===================== Reviews: signed-in toggle, no self-marking =====

create table if not exists public.review_helpful_votes (
  id uuid primary key default gen_random_uuid(),
  review_id uuid not null references public.reviews (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  created_at timestamptz not null default now(),
  unique (review_id, user_id)
);

create index if not exists review_helpful_votes_review_idx on public.review_helpful_votes (review_id);

alter table public.review_helpful_votes enable row level security;

drop policy if exists "Users see their own review votes" on public.review_helpful_votes;
create policy "Users see their own review votes"
  on public.review_helpful_votes for select
  using (user_id = auth.uid());

create or replace function public.toggle_review_helpful(p_review_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_exists boolean;
  v_count int;
begin
  if auth.uid() is null then
    raise exception 'Sign in to mark reviews helpful';
  end if;
  if exists (
    select 1 from public.reviews r
    where r.id = p_review_id and lower(r.reviewer_email) = any (public.current_user_emails())
  ) then
    raise exception 'You cannot mark your own review helpful';
  end if;

  select exists (
    select 1 from public.review_helpful_votes where review_id = p_review_id and user_id = auth.uid()
  ) into v_exists;

  if v_exists then
    delete from public.review_helpful_votes where review_id = p_review_id and user_id = auth.uid();
    update public.reviews set helpful_count = greatest(helpful_count - 1, 0)
    where id = p_review_id returning helpful_count into v_count;
    return jsonb_build_object('voted', false, 'count', coalesce(v_count, 0));
  else
    insert into public.review_helpful_votes (review_id, user_id) values (p_review_id, auth.uid());
    update public.reviews set helpful_count = helpful_count + 1
    where id = p_review_id returning helpful_count into v_count;
    return jsonb_build_object('voted', true, 'count', coalesce(v_count, 0));
  end if;
end;
$$;

revoke execute on function public.toggle_review_helpful(uuid) from public, anon;
grant execute on function public.toggle_review_helpful(uuid) to authenticated;

-- ===================== Admin: revenue by brand =====================

create or replace function public.admin_revenue_by_brand()
returns setof jsonb
language sql
stable
security definer
set search_path = public
as $$
  select jsonb_build_object(
    'brand', t.brand,
    'revenue', t.revenue,
    'orders', t.orders
  )
  from (
    select l.brand as brand,
           coalesce(sum(o.total), 0) as revenue,
           count(o.id) as orders
    from public.orders o
    join public.listings l on l.id = o.listing_id
    where public.is_admin() and o.payment_verified
    group by l.brand
  ) t
  order by t.revenue desc;
$$;

revoke execute on function public.admin_revenue_by_brand() from public, anon;
grant execute on function public.admin_revenue_by_brand() to authenticated;
