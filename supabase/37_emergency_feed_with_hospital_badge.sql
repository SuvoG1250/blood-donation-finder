-- Emergency feed RPC that includes hospital verified badge.
-- Allows public/anon to read "hospital is_verified" without exposing hospital user rows directly.

create or replace function public.get_emergency_feed(limit_rows int default 30)
returns table (
  request_id uuid,
  blood_group text,
  district text,
  block text,
  panchayat text,
  patient_name text,
  request_details text,
  contact_number text,
  created_at timestamptz,
  status text,
  hospital_user_id uuid,
  expires_at timestamptz,
  hospital_is_verified boolean
)
language sql
security definer
set search_path = public, auth
as $$
  select
    e.request_id,
    e.blood_group,
    e.district,
    e.block,
    e.panchayat,
    e.patient_name,
    e.request_details,
    e.contact_number,
    e.created_at,
    e.status,
    e.hospital_user_id,
    e.expires_at,
    coalesce(hu.is_verified, false) as hospital_is_verified
  from public.emergency_requests e
  left join public.hospital_users hu on hu.user_id = e.hospital_user_id
  order by e.created_at desc
  limit greatest(1, least(limit_rows, 100));
$$;

grant execute on function public.get_emergency_feed(int) to anon, authenticated;

