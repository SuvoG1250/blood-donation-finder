-- Full public donor profile for QR scan (run in Supabase SQL Editor)

drop function if exists public.get_public_donor_profile(uuid);

create or replace function public.get_public_donor_profile(p_user_id uuid)
returns table (
  user_id uuid,
  name text,
  email text,
  blood_group text,
  pincode text,
  district text,
  block text,
  panchayat text,
  village text,
  contact_number text,
  photo_object_path text,
  preferred_days text[],
  preferred_time_slots text[],
  id_card_verified boolean,
  last_donation_date date,
  pause_until timestamptz,
  is_eligible boolean
)
language sql
stable
security definer
set search_path = public
as $$
  select
    d.user_id,
    d.name,
    u.email::text,
    d.blood_group,
    coalesce(d.pincode, '') as pincode,
    d.district,
    d.block,
    d.panchayat,
    coalesce(d.village, '') as village,
    d.contact_number,
    d.photo_object_path,
    d.preferred_days,
    d.preferred_time_slots,
    d.id_card_verified,
    d.last_donation_date,
    d.pause_until,
    public.is_donor_eligible(d.last_donation_date) as is_eligible
  from public.donors d
  join auth.users u on u.id = d.user_id
  where d.user_id = p_user_id
    and d.id_card_verified = true
    and public.is_donor_eligible(d.last_donation_date) = true
    and (d.pause_until is null or d.pause_until <= now())
  limit 1;
$$;

grant execute on function public.get_public_donor_profile(uuid) to anon, authenticated;
