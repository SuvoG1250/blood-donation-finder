-- Allow authenticated (non-hospital) users to create open emergency requests.
-- This keeps the feed truly public ("anyone can post") while still preventing
-- authenticated users from creating hospital-managed requests.

drop policy if exists "emergencies_insert_authenticated_open" on public.emergency_requests;
create policy "emergencies_insert_authenticated_open"
on public.emergency_requests
for insert
to authenticated
with check (
  status = 'open'
  and hospital_user_id is null
);

