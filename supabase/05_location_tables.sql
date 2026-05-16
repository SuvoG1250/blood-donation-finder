-- Location lookup tables for West Bengal.
-- These tables back dependent dropdowns:
-- District -> Block -> Panchayat.

create table if not exists public.districts (
  district_id uuid primary key default gen_random_uuid(),
  district_name text not null unique,
  created_at timestamptz not null default now()
);

create table if not exists public.blocks (
  block_id uuid primary key default gen_random_uuid(),
  district_id uuid not null references public.districts(district_id) on delete cascade,
  block_name text not null,
  created_at timestamptz not null default now(),
  unique(district_id, block_name)
);

create table if not exists public.panchayats (
  panchayat_id uuid primary key default gen_random_uuid(),
  block_id uuid not null references public.blocks(block_id) on delete cascade,
  panchayat_name text not null,
  created_at timestamptz not null default now(),
  unique(block_id, panchayat_name)
);

-- Optional: blood group dropdown source.
-- Your current app stores blood_group as text in `donors`.
-- This table provides a consistent dropdown list.
create table if not exists public.blood_groups (
  blood_group text primary key,
  display_name text not null,
  sort_order int not null default 0
);

