-- Trusted donor + admin notes metadata

create table if not exists public.donor_verification_metadata (
  donor_user_id uuid primary key references public.donors(user_id) on delete cascade,
  trusted_donor boolean not null default false,
  verification_notes text null,
  updated_at timestamptz not null default now()
);

alter table public.donor_verification_metadata enable row level security;

-- Keep updated_at fresh on edits
drop trigger if exists trg_donor_verification_metadata_updated_at
  on public.donor_verification_metadata;
create trigger trg_donor_verification_metadata_updated_at
before update on public.donor_verification_metadata
for each row execute function public.set_updated_at();

-- Public can only read metadata for donors that match the current search filters
-- (same filters as donors_select_public_filtered_eligible).
drop policy if exists donor_verification_select_public on public.donor_verification_metadata;
create policy donor_verification_select_public
on public.donor_verification_metadata
for select
to public
using (
  exists (
    select 1
    from public.donors d
    where d.user_id = donor_user_id
      and d.id_card_verified = true
      and public.is_donor_eligible(d.last_donation_date) = true
      and upper(d.blood_group) = current_setting('request.blood_group', true)
      and lower(d.district) = current_setting('request.district', true)
      and lower(d.block) = current_setting('request.block', true)
      and lower(d.panchayat) = current_setting('request.panchayat', true)
  )
);

-- Donor can see their own metadata
drop policy if exists donor_verification_select_own on public.donor_verification_metadata;
create policy donor_verification_select_own
on public.donor_verification_metadata
for select
to authenticated
using (donor_user_id = auth.uid());

-- Admin can see everything
drop policy if exists donor_verification_select_admin on public.donor_verification_metadata;
create policy donor_verification_select_admin
on public.donor_verification_metadata
for select
to authenticated
using (public.is_admin());

-- Admin-only inserts/updates
drop policy if exists donor_verification_insert_admin on public.donor_verification_metadata;
create policy donor_verification_insert_admin
on public.donor_verification_metadata
for insert
to authenticated
with check (public.is_admin());

drop policy if exists donor_verification_update_admin on public.donor_verification_metadata;
create policy donor_verification_update_admin
on public.donor_verification_metadata
for update
to authenticated
using (public.is_admin())
with check (public.is_admin());

