-- Recreate donor matching RPC to repair missing/invalid remote function definitions.
drop function if exists public.get_donors_for_emergency(
  text,
  text,
  text,
  text,
  text,
  text
);

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

