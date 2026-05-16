-- Donor pause availability, emergency verification, hospital verified badge, and donor alert inbox support.

-- 1) Donor pause availability
alter table public.donors
  add column if not exists pause_until timestamptz null;

create index if not exists donors_pause_until_idx
  on public.donors (pause_until);

-- 2) Emergency verification flags (gate notifications)
alter table public.emergency_requests
  add column if not exists verified_status text not null default 'pending',
  add column if not exists verified_by uuid null references public.profiles(user_id) on delete set null,
  add column if not exists verified_at timestamptz null,
  add column if not exists verified_note text null;

do $$ begin
  if not exists (
    select 1 from pg_constraint where conname = 'emergency_requests_verified_status_check'
  ) then
    alter table public.emergency_requests
      add constraint emergency_requests_verified_status_check
      check (verified_status in ('pending','verified','suspected_spam'));
  end if;
end $$;

create index if not exists emergency_requests_verified_idx
  on public.emergency_requests (verified_status, created_at desc);

-- 3) Hospital verification badge
alter table public.hospital_users
  add column if not exists is_verified boolean not null default false;

-- 4) Update donor matching RPC to exclude paused donors
create or replace function public.get_donors_for_emergency(
  p_blood_group text,
  p_district text,
  p_block text,
  p_panchayat text,
  p_day text,
  p_time_slot text
)
returns table (
  donor_user_id uuid,
  email text,
  name text,
  blood_group text,
  district text,
  block text,
  panchayat text
)
language sql
security definer
set search_path = public, auth
as $$
  select
    d.user_id as donor_user_id,
    u.email,
    d.name,
    d.blood_group,
    d.district,
    d.block,
    d.panchayat
  from public.donors d
  join auth.users u on u.id = d.user_id
  where
    d.id_card_verified = true
    and public.is_donor_eligible(d.last_donation_date) = true
    and (d.pause_until is null or d.pause_until <= now())
    and upper(d.blood_group) = upper(trim(p_blood_group))
    and lower(d.district) = lower(trim(p_district))
    and lower(d.block) = lower(trim(p_block))
    and lower(d.panchayat) = lower(trim(p_panchayat))
    and (
      coalesce(cardinality(d.preferred_days), 0) = 0
      or p_day = any(d.preferred_days)
    )
    and (
      coalesce(cardinality(d.preferred_time_slots), 0) = 0
      or p_time_slot = any(d.preferred_time_slots)
    )
  limit 50;
$$;

grant execute on function public.get_donors_for_emergency(
  text,
  text,
  text,
  text,
  text,
  text
) to authenticated, service_role;

