-- Donation history for donor dashboard and certificates

create table if not exists public.donation_history (
  donation_id uuid primary key default gen_random_uuid(),
  donor_user_id uuid not null references public.donors(user_id) on delete cascade,
  donated_at timestamptz not null default now(),
  donation_date date not null,
  hospital_name text null,
  location text null,
  units text null,
  notes text null,
  created_at timestamptz not null default now()
);

alter table public.donation_history enable row level security;

drop policy if exists "donation_history_select_own" on public.donation_history;
create policy "donation_history_select_own"
on public.donation_history
for select
to authenticated
using (donor_user_id = auth.uid());

drop policy if exists "donation_history_insert_own" on public.donation_history;
create policy "donation_history_insert_own"
on public.donation_history
for insert
to authenticated
with check (donor_user_id = auth.uid());

drop policy if exists "donation_history_update_own" on public.donation_history;
create policy "donation_history_update_own"
on public.donation_history
for update
to authenticated
using (donor_user_id = auth.uid())
with check (donor_user_id = auth.uid());

drop policy if exists "donation_history_select_admin" on public.donation_history;
create policy "donation_history_select_admin"
on public.donation_history
for select
to authenticated
using (public.is_admin());

