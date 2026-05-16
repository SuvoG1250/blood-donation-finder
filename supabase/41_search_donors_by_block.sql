-- Block-wide donor search (all panchayats in a block) for PIN-based lookup.

drop policy if exists "donors_select_public_filtered_eligible" on public.donors;
create policy "donors_select_public_filtered_eligible"
on public.donors
for select
to public
using (
  id_card_verified = true
  and public.is_donor_eligible(last_donation_date) = true
  and (pause_until is null or pause_until <= now())
  and upper(blood_group) = current_setting('request.blood_group', true)
  and lower(district) = current_setting('request.district', true)
  and lower(block) = current_setting('request.block', true)
  and (
    coalesce(current_setting('request.block_only', true), '') = 'true'
    or lower(panchayat) = current_setting('request.panchayat', true)
  )
);

drop function if exists public.search_donors_by_block(text, text, text);

create or replace function public.search_donors_by_block(
  p_blood_group text,
  p_district text,
  p_block text
)
returns table (
  user_id uuid,
  name text,
  photo_object_path text,
  blood_group text,
  district text,
  block text,
  panchayat text,
  village text,
  last_donation_date date,
  contact_number text,
  preferred_days text[],
  preferred_time_slots text[],
  trusted_donor boolean
)
language plpgsql
security invoker
as $$
begin
  if p_blood_group is null or p_district is null or p_block is null then
    raise exception 'Blood group, district, and block are required';
  end if;

  perform set_config('request.blood_group', upper(trim(p_blood_group)), true);
  perform set_config('request.district', lower(trim(p_district)), true);
  perform set_config('request.block', lower(trim(p_block)), true);
  perform set_config('request.block_only', 'true', true);

  return query
  select
    d.user_id,
    d.name,
    d.photo_object_path,
    d.blood_group,
    d.district,
    d.block,
    d.panchayat,
    d.village,
    d.last_donation_date,
    d.contact_number,
    d.preferred_days,
    d.preferred_time_slots,
    coalesce(d.is_trusted, false) as trusted_donor
  from public.donors d;
end;
$$;

grant execute on function public.search_donors_by_block(text, text, text) to public;
