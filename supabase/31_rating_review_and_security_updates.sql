-- Rating/review enhancements + anti-abuse constraints.

-- One rater can keep one latest rating per donor (upsert-friendly).
create unique index if not exists donor_ratings_unique_rater_target
  on public.donor_ratings (donor_user_id, rater_user_id);

-- Replace strict admin-only insert with authenticated self-attributed insert.
drop policy if exists "donor_ratings_insert_admin" on public.donor_ratings;
drop policy if exists "donor_ratings_insert_authenticated" on public.donor_ratings;
create policy "donor_ratings_insert_authenticated"
on public.donor_ratings
for insert
to authenticated
with check (
  rater_user_id = auth.uid()
  and donor_user_id <> auth.uid()
);

-- Allow rater to update their own previous rating.
drop policy if exists "donor_ratings_update_own_rating" on public.donor_ratings;
create policy "donor_ratings_update_own_rating"
on public.donor_ratings
for update
to authenticated
using (rater_user_id = auth.uid())
with check (rater_user_id = auth.uid());

-- Public-safe aggregate view via RPC (no raw comments exposed).
create or replace function public.get_donor_rating_summaries(p_donor_user_ids uuid[])
returns table (
  donor_user_id uuid,
  rating_count bigint,
  rating_avg numeric
)
language sql
stable
security definer
set search_path = public
as $$
  select
    r.donor_user_id,
    count(*)::bigint as rating_count,
    coalesce(avg(r.stars)::numeric, 0)::numeric as rating_avg
  from public.donor_ratings r
  where r.donor_user_id = any(p_donor_user_ids)
  group by r.donor_user_id;
$$;

grant execute on function public.get_donor_rating_summaries(uuid[]) to anon, authenticated;

