-- Cornell Craves: reviews + Q&A posting rules (Batch 2 #7, #8, #13).
--   #13: only a signed-in student who actually bought from the listing (an order
--        with payment_verified = true, or picked_up) may post a review.
--   #7:  clubs can respond to reviews but never post them.
--   #8:  clubs can answer questions but never ask them.
-- Reviews are now inserted ONLY through the post_review SECURITY DEFINER RPC,
-- which enforces all of the above; direct inserts are removed.

-- ===================== Reviews =====================

-- Remove the permissive direct-insert policy. With no INSERT policy, RLS denies
-- direct inserts; post_review (security definer) is the only write path.
drop policy if exists "Anyone can post a review" on public.reviews;

-- True when the caller is a signed-in non-club user who has a qualifying order
-- on this listing and has not already reviewed it. Drives the UI form gating.
create or replace function public.can_i_review(p_listing_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select
    auth.uid() is not null
    and not exists (select 1 from public.clubs c where c.id = auth.uid())
    and exists (
      select 1 from public.orders o
      where o.listing_id = p_listing_id
        and o.user_id = auth.uid()
        and o.status <> 'cancelled'
        and (o.payment_verified = true or o.status = 'picked_up')
    )
    and not exists (
      select 1 from public.reviews r
      where r.listing_id = p_listing_id
        and lower(r.reviewer_email) = any (public.current_user_emails())
    );
$$;

create or replace function public.post_review(
  p_listing_id uuid,
  p_rating int,
  p_title text,
  p_body text,
  p_reviewer_name text
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_email text;
  v_id uuid;
begin
  if auth.uid() is null then
    raise exception 'Sign in to leave a review';
  end if;
  if exists (select 1 from public.clubs c where c.id = auth.uid()) then
    raise exception 'Clubs cannot post reviews';
  end if;
  if p_rating < 1 or p_rating > 5 then
    raise exception 'Rating must be between 1 and 5';
  end if;
  if trim(coalesce(p_title, '')) = '' or trim(coalesce(p_body, '')) = '' then
    raise exception 'Add a title and a review';
  end if;
  if not exists (
    select 1 from public.orders o
    where o.listing_id = p_listing_id
      and o.user_id = auth.uid()
      and o.status <> 'cancelled'
      and (o.payment_verified = true or o.status = 'picked_up')
  ) then
    raise exception 'Only verified buyers can review this drop';
  end if;

  v_email := lower(coalesce((public.current_user_emails())[1], ''));
  if v_email = '' then
    raise exception 'Your account has no email on file';
  end if;

  begin
    insert into public.reviews (listing_id, reviewer_email, reviewer_name, rating, title, body)
    values (p_listing_id, v_email, trim(p_reviewer_name), p_rating, trim(p_title), trim(p_body))
    returning id into v_id;
  exception
    when unique_violation then
      raise exception 'You already reviewed this drop';
  end;
  return v_id;
end;
$$;

revoke execute on function public.can_i_review(uuid) from public, anon;
revoke execute on function public.post_review(uuid, int, text, text, text) from public, anon;
grant execute on function public.can_i_review(uuid) to authenticated;
grant execute on function public.post_review(uuid, int, text, text, text) to authenticated;

-- ===================== Q&A =====================

-- Clubs may answer (existing UPDATE policy) but not ask. Replace the open
-- insert policy: anonymous askers (auth.uid() null) are still allowed; any
-- signed-in club owner is blocked.
drop policy if exists "Anyone can ask a question" on public.qa;

create policy "Non-club users can ask"
  on public.qa for insert
  with check (not exists (select 1 from public.clubs c where c.id = auth.uid()));
