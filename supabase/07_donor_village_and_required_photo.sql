-- Donor registration hard requirements + village support.
-- Run after 01/02/03 and after 04_approval_passwords.sql

-- Village (mandatory in UI)
alter table public.donors
  add column if not exists village text;

-- Donor photo should be mandatory for verification.
-- Existing column is photo_object_path (currently nullable).
-- If you already have rows, fill them before enforcing NOT NULL.
-- Uncomment when ready:
-- alter table public.donors
--   alter column photo_object_path set not null;

