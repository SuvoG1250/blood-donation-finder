-- Extend the search_donors RPC to also return donor availability preferences.
-- This enables seekers to filter based on preferred day/time slots.

create or replace function public.search_donors(
  p_blood_group text,
  p_district text,
  p_block text,
  p_panchayat text
)
returns table (
  user_id uuid,
  name text,
  photo_object_path text,
  blood_group text,
  district text,
  block text,
  panchayat text,
  last_donation_date date,
  contact_number text,
  preferred_days text[],
  preferred_time_slots text[]
)
language plpgsql
security invoker
as $$
begin
  if p_blood_group is null or p_district is null or p_block is null or p_panchayat is null then
    raise exception 'All filters are required';
  end if;

  perform set_config('request.blood_group', upper(trim(p_blood_group)), true);
  perform set_config('request.district', lower(trim(p_district)), true);
  perform set_config('request.block', lower(trim(p_block)), true);
  perform set_config('request.panchayat', lower(trim(p_panchayat)), true);

  return query
  select
    d.user_id,
    d.name,
    d.photo_object_path,
    d.blood_group,
    d.district,
    d.block,
    d.panchayat,
    d.last_donation_date,
    d.contact_number,
    d.preferred_days,
    d.preferred_time_slots
  from public.donors d;
end;
$$;

grant execute on function public.search_donors(text, text, text, text) to public;

