-- Rate limiting / abuse protection for emergency posts.
-- We will deny direct client inserts for "public" emergencies so all
-- non-hospital posting goes through the Edge Function `post-emergency`.

alter table public.emergency_requests
  add column if not exists created_ip text null;

-- Remove the old public insert policy.
drop policy if exists "emergencies_insert_public" on public.emergency_requests;

-- Keep hospital inserts (from 13_hospital_accounts_and_emergency_status.sql).
-- If you're running this on a fresh DB, ensure the hospital insert policy exists.

