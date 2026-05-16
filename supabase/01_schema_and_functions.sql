-- Blood Donation & Finder (Supabase) - Schema + Functions
-- Run in Supabase SQL editor (order matters).

create extension if not exists pgcrypto;

-- Roles within our app
do $$ begin
  create type public.user_role as enum ('donor', 'seeker');
exception
  when duplicate_object then null;
end $$;

-- Base profile table (one row per auth user)
create table if not exists public.profiles (
  user_id uuid primary key references auth.users(id) on delete cascade,
  role public.user_role not null default 'seeker',
  created_at timestamptz not null default now()
);

-- Donor records (visible in search only when verified + eligible)
create table if not exists public.donors (
  user_id uuid primary key references public.profiles(user_id) on delete cascade,

  name text not null,
  photo_object_path text null,

  blood_group text not null,
  district text not null,
  block text not null,
  panchayat text not null,

  last_donation_date date not null,

  -- Hidden in UI, but required for WhatsApp contact links.
  contact_number text not null,

  -- Mandatory ID card front image: visible only to admin via Storage policies.
  id_card_object_path text not null,
  id_card_verified boolean not null default false,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- Admin users (stored separately from donors/seeker)
create table if not exists public.admin_users (
  user_id uuid primary key references public.profiles(user_id) on delete cascade,
  created_at timestamptz not null default now()
);

-- Emergency blood requests (public read + public write)
create table if not exists public.emergency_requests (
  request_id uuid primary key default gen_random_uuid(),

  blood_group text not null,
  district text not null,
  block text not null,
  panchayat text not null,

  patient_name text null,
  request_details text not null,

  contact_number text not null,
  created_by uuid null references public.profiles(user_id) on delete set null,

  created_at timestamptz not null default now()
);

-- Optional audit trail
create table if not exists public.donor_verification_events (
  event_id uuid primary key default gen_random_uuid(),
  donor_user_id uuid not null references public.donors(user_id) on delete cascade,
  admin_user_id uuid not null references public.admin_users(user_id) on delete cascade,
  verified_at timestamptz not null default now(),
  note text null
);

-- Trigger: update updated_at
create or replace function public.set_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists trg_donors_updated_at on public.donors;
create trigger trg_donors_updated_at
before update on public.donors
for each row execute function public.set_updated_at();

-- Trigger: auto-create a profile row for every new auth user
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
as $$
begin
  insert into public.profiles (user_id, role)
  values (new.id, 'seeker')
  on conflict (user_id) do nothing;

  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
after insert on auth.users
for each row execute function public.handle_new_user();

-- Eligibility: donor is eligible if last donation is >= 90 days ago
create or replace function public.is_donor_eligible(p_last_donation_date date)
returns boolean
language sql
stable
as $$
  select p_last_donation_date is not null
    and p_last_donation_date <= (current_date - interval '90 days')
$$;

-- Admin check
create or replace function public.is_admin()
returns boolean
language sql
stable
as $$
  select exists (
    select 1
    from public.admin_users a
    where a.user_id = auth.uid()
  )
$$;

-- RPC used by the seeker search UI.
-- It sets request filters for RLS policies and returns eligible donors.
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
  contact_number text
)
language plpgsql
security invoker
as $$
begin
  if p_blood_group is null or p_district is null or p_block is null or p_panchayat is null then
    raise exception 'All filters are required';
  end if;

  -- Normalize values so matching is reliable
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
    d.contact_number
  from public.donors d;
end;
$$;

grant execute on function public.is_admin() to authenticated;
grant execute on function public.is_donor_eligible(date) to authenticated;

-- Allow anonymous (public) access to search.
-- RLS will still restrict rows to verified + eligible donors and exact filters.
grant execute on function public.search_donors(text, text, text, text) to public;

