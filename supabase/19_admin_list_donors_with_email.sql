-- Admin-only RPC to list donors with auth email.
-- This avoids exposing auth.users directly to the client.

create or replace function public.admin_list_donors()
returns table (
  user_id uuid,
  email text,
  name text,
  blood_group text,
  district text,
  block text,
  panchayat text,
  village text,
  last_donation_date date,
  contact_number text,
  photo_object_path text,
  id_card_object_path text,
  id_card_verified boolean,
  reviewed_at timestamptz,
  rejection_reason text
)
language sql
security definer
set search_path = public, auth
as $$
  select
    d.user_id,
    u.email,
    d.name,
    d.blood_group,
    d.district,
    d.block,
    d.panchayat,
    d.village,
    d.last_donation_date,
    d.contact_number,
    d.photo_object_path,
    d.id_card_object_path,
    d.id_card_verified,
    d.reviewed_at,
    d.rejection_reason
  from public.donors d
  join auth.users u on u.id = d.user_id
  where public.is_admin() = true
  order by d.id_card_verified asc, d.created_at desc;
$$;

grant execute on function public.admin_list_donors() to authenticated;

