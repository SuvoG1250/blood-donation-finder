-- Admin broadcast recipients helper (service-side).
-- Returns eligible, verified, non-paused donors with their auth email.

create or replace function public.get_broadcast_recipients(
  p_blood_group text,
  p_district text,
  p_block text default null,
  p_panchayat text default null
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
    and (p_block is null or p_block = '' or lower(d.block) = lower(trim(p_block)))
    and (p_panchayat is null or p_panchayat = '' or lower(d.panchayat) = lower(trim(p_panchayat)))
  limit 800;
$$;

grant execute on function public.get_broadcast_recipients(text, text, text, text)
to service_role;

