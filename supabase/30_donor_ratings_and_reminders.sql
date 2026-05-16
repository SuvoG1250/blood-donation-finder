-- Donor rating system + optional eligibility reminders.

-- 1) Donor ratings (admin-created; donor can read own ratings)
create table if not exists public.donor_ratings (
  rating_id uuid primary key default gen_random_uuid(),
  donor_user_id uuid not null references public.donors(user_id) on delete cascade,
  rater_user_id uuid not null references public.profiles(user_id) on delete set null,
  emergency_request_id uuid null references public.emergency_requests(request_id) on delete set null,
  stars int not null check (stars between 1 and 5),
  comment text null,
  created_at timestamptz not null default now()
);

create index if not exists donor_ratings_donor_idx
  on public.donor_ratings (donor_user_id, created_at desc);

alter table public.donor_ratings enable row level security;

-- Donor can see their own ratings.
drop policy if exists "donor_ratings_select_own" on public.donor_ratings;
create policy "donor_ratings_select_own"
on public.donor_ratings
for select
to authenticated
using (donor_user_id = auth.uid());

-- Admin can see all ratings.
drop policy if exists "donor_ratings_select_admin" on public.donor_ratings;
create policy "donor_ratings_select_admin"
on public.donor_ratings
for select
to authenticated
using (public.is_admin());

-- Admin can create ratings (simple + safe default).
drop policy if exists "donor_ratings_insert_admin" on public.donor_ratings;
create policy "donor_ratings_insert_admin"
on public.donor_ratings
for insert
to authenticated
with check (
  public.is_admin()
  and rater_user_id = auth.uid()
);

-- Donor rating summary RPC (safe for authenticated; only returns for the requested donor id)
create or replace function public.get_donor_rating_summary(p_donor_user_id uuid)
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
    p_donor_user_id as donor_user_id,
    count(*)::bigint as rating_count,
    coalesce(avg(stars)::numeric, 0)::numeric as rating_avg
  from public.donor_ratings r
  where r.donor_user_id = p_donor_user_id
    and (p_donor_user_id = auth.uid() or public.is_admin() = true);
$$;

grant execute on function public.get_donor_rating_summary(uuid) to authenticated;

-- 2) Donor notification preferences (for optional reminders)
create table if not exists public.donor_notification_prefs (
  donor_user_id uuid primary key references public.donors(user_id) on delete cascade,
  eligibility_reminders_enabled boolean not null default true,
  last_eligibility_reminder_sent_at timestamptz null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.donor_notification_prefs enable row level security;

drop policy if exists "donor_notification_prefs_select_own" on public.donor_notification_prefs;
create policy "donor_notification_prefs_select_own"
on public.donor_notification_prefs
for select
to authenticated
using (donor_user_id = auth.uid());

drop policy if exists "donor_notification_prefs_upsert_own" on public.donor_notification_prefs;
create policy "donor_notification_prefs_upsert_own"
on public.donor_notification_prefs
for insert
to authenticated
with check (donor_user_id = auth.uid());

drop policy if exists "donor_notification_prefs_update_own" on public.donor_notification_prefs;
create policy "donor_notification_prefs_update_own"
on public.donor_notification_prefs
for update
to authenticated
using (donor_user_id = auth.uid())
with check (donor_user_id = auth.uid());

-- Trigger for updated_at (re-use existing set_updated_at()).
drop trigger if exists trg_donor_notification_prefs_updated_at on public.donor_notification_prefs;
create trigger trg_donor_notification_prefs_updated_at
before update on public.donor_notification_prefs
for each row execute function public.set_updated_at();

