-- Donor profile: editable address fields (run in Supabase SQL Editor)
-- Safe to run more than once.

-- Village (from 07; repeated here if that migration was skipped)
alter table public.donors
  add column if not exists village text;

-- Optional PIN for donor profile / search display
alter table public.donors
  add column if not exists pincode text;

comment on column public.donors.pincode is 'West Bengal PIN from India Post lookup (donor profile)';

-- Faster location filters in admin/search
create index if not exists donors_district_block_idx
  on public.donors (district, block);

-- Donors may update their own row (including address) — policy from 02_rls.sql:
--   donors_update_own  USING (user_id = auth.uid())  WITH CHECK (user_id = auth.uid())
-- No extra RLS needed unless you restricted columns; if updates fail, re-run:
--
-- drop policy if exists "donors_update_own" on public.donors;
-- create policy "donors_update_own"
-- on public.donors for update to authenticated
-- using (user_id = auth.uid()) with check (user_id = auth.uid());
