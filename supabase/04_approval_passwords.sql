-- Additional columns for admin-approved onboarding with temporary passwords.
-- Run after:
-- - 01_schema_and_functions.sql
-- - 02_rls.sql
-- - 03_storage.sql

-- Force first-login password change after admin approval.
alter table public.profiles
  add column if not exists must_change_password boolean not null default false,
  add column if not exists temp_password_set_at timestamptz null,
  add column if not exists temp_password_expires_at timestamptz null;

-- Store admin review metadata for donors.
alter table public.donors
  add column if not exists reviewed_at timestamptz null,
  add column if not exists reviewed_by uuid null,
  add column if not exists rejection_reason text null;

