-- Public donor profile RPC (for QR verification page).

create or replace function public.get_public_donor_profile(p_user_id uuid)
returns table (
  user_id uuid,
  name text,
  blood_group text,
  district text,
  block text,
  panchayat text,
  village text,
  id_card_verified boolean,
  last_donation_date date,
  pause_until timestamptz
)
language sql
stable
security definer
set search_path = public
as $$
  select
    d.user_id,
    d.name,
    d.blood_group,
    d.district,
    d.block,
    d.panchayat,
    coalesce(d.village, '') as village,
    d.id_card_verified,
    d.last_donation_date,
    d.pause_until
  from public.donors d
  where d.user_id = p_user_id
    and d.id_card_verified = true
    and public.is_donor_eligible(d.last_donation_date) = true
    and (d.pause_until is null or d.pause_until <= now())
  limit 1;
$$;

grant execute on function public.get_public_donor_profile(uuid) to anon, authenticated;

