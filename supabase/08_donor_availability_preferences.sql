-- Donor availability preferences (Feature #1)
-- Run after 01_schema_and_functions.sql and 07_donor_village_and_required_photo.sql.

alter table public.donors
  add column if not exists preferred_days text[] not null default '{}',
  add column if not exists preferred_time_slots text[] not null default '{}';

