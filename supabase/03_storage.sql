-- Blood Donation & Finder (Supabase) - Storage Policies
--
-- NOTE:
-- `storage.objects` is owned by Supabase internal roles.
-- In many projects, running `alter table storage.objects ...` from SQL editor fails with:
--   must be owner of table objects
-- RLS is already managed on this table, so we only create/drop policies here.

-- Private ID cards: only admin can select/view.
drop policy if exists "donor_upload_own_id" on storage.objects;
create policy "donor_upload_own_id"
on storage.objects
for insert
to authenticated
with check (
  bucket_id = 'donor-ids'
  and split_part(name, '/', 1) = auth.uid()::text
);

drop policy if exists "donor_update_own_id" on storage.objects;
create policy "donor_update_own_id"
on storage.objects
for update
to authenticated
using (
  bucket_id = 'donor-ids'
  and split_part(name, '/', 1) = auth.uid()::text
)
with check (
  bucket_id = 'donor-ids'
  and split_part(name, '/', 1) = auth.uid()::text
);

drop policy if exists "admin_read_id_cards" on storage.objects;
create policy "admin_read_id_cards"
on storage.objects
for select
to authenticated
using (
  bucket_id = 'donor-ids'
  and public.is_admin()
);

-- Donor profile photos: allow donors to upload their own.
-- (Search UI currently doesn't render photos, but uploads are supported.)
drop policy if exists "donor_upload_own_photo" on storage.objects;
create policy "donor_upload_own_photo"
on storage.objects
for insert
to authenticated
with check (
  bucket_id = 'donor-photos'
  and split_part(name, '/', 1) = auth.uid()::text
);

drop policy if exists "donor_update_own_photo" on storage.objects;
create policy "donor_update_own_photo"
on storage.objects
for update
to authenticated
using (
  bucket_id = 'donor-photos'
  and split_part(name, '/', 1) = auth.uid()::text
)
with check (
  bucket_id = 'donor-photos'
  and split_part(name, '/', 1) = auth.uid()::text
);

-- Optional: allow public to read donor photos.
drop policy if exists "public_read_donor_photos" on storage.objects;
create policy "public_read_donor_photos"
on storage.objects
for select
to public
using (bucket_id = 'donor-photos');

