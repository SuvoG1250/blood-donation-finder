-- Blood Donation & Finder (Supabase) - RLS Policies

alter table public.profiles enable row level security;
alter table public.donors enable row level security;
alter table public.admin_users enable row level security;
alter table public.emergency_requests enable row level security;
alter table public.donor_verification_events enable row level security;

-- =========================
-- profiles
-- =========================
drop policy if exists "profiles_select_self" on public.profiles;
create policy "profiles_select_self"
on public.profiles
for select
to authenticated
using (user_id = auth.uid());

drop policy if exists "profiles_update_self" on public.profiles;
create policy "profiles_update_self"
on public.profiles
for update
to authenticated
using (user_id = auth.uid())
with check (user_id = auth.uid());

-- =========================
-- admin_users
-- =========================
drop policy if exists "admin_users_select_self" on public.admin_users;
create policy "admin_users_select_self"
on public.admin_users
for select
to authenticated
using (user_id = auth.uid());

-- =========================
-- donors
-- =========================
drop policy if exists "donors_insert_own" on public.donors;
create policy "donors_insert_own"
on public.donors
for insert
to authenticated
with check (
  user_id = auth.uid()
);

drop policy if exists "donors_update_own" on public.donors;
create policy "donors_update_own"
on public.donors
for update
to authenticated
using (user_id = auth.uid())
with check (
  user_id = auth.uid()
);

-- Allow donors to view their own donor record (used by donor dashboard).
drop policy if exists "donors_select_own" on public.donors;
create policy "donors_select_own"
on public.donors
for select
to authenticated
using (
  user_id = auth.uid()
);

drop policy if exists "donors_select_admin" on public.donors;
create policy "donors_select_admin"
on public.donors
for select
to authenticated
using (public.is_admin());

drop policy if exists "donors_update_admin" on public.donors;
create policy "donors_update_admin"
on public.donors
for update
to authenticated
using (public.is_admin())
with check (public.is_admin());

-- Public search: donors must be verified + eligible and match exact filters.
-- (No sign-in needed for find donor.)
drop policy if exists "donors_select_seekers_filtered_eligible" on public.donors;
drop policy if exists "donors_select_public_filtered_eligible" on public.donors;
create policy "donors_select_public_filtered_eligible"
on public.donors
for select
to public
using (
  id_card_verified = true
  and public.is_donor_eligible(last_donation_date) = true
  and upper(blood_group) = current_setting('request.blood_group', true)
  and lower(district) = current_setting('request.district', true)
  and lower(block) = current_setting('request.block', true)
  and lower(panchayat) = current_setting('request.panchayat', true)
);

-- =========================
-- emergency_requests
-- =========================
drop policy if exists "emergencies_select_public" on public.emergency_requests;
create policy "emergencies_select_public"
on public.emergency_requests
for select
to public
using (true);

drop policy if exists "emergencies_insert_public" on public.emergency_requests;
create policy "emergencies_insert_public"
on public.emergency_requests
for insert
to public
with check (true);

