-- RLS policies for location lookup tables.
-- Dropdown data is not sensitive, so allow public reads.

alter table public.districts enable row level security;
alter table public.blocks enable row level security;
alter table public.panchayats enable row level security;
alter table public.blood_groups enable row level security;

drop policy if exists "districts_public_select" on public.districts;
create policy "districts_public_select"
on public.districts
for select
to public
using (true);

drop policy if exists "blocks_public_select" on public.blocks;
create policy "blocks_public_select"
on public.blocks
for select
to public
using (true);

drop policy if exists "panchayats_public_select" on public.panchayats;
create policy "panchayats_public_select"
on public.panchayats
for select
to public
using (true);

drop policy if exists "blood_groups_public_select" on public.blood_groups;
create policy "blood_groups_public_select"
on public.blood_groups
for select
to public
using (true);

