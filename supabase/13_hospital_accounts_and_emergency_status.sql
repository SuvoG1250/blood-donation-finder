-- Hospital accounts + emergency request lifecycle
-- Run after 01_schema_and_functions.sql and 02_rls.sql.

-- 1) Extend user_role enum with 'hospital'
do $$
begin
  if not exists (
    select 1
    from pg_type t
    join pg_enum e on e.enumtypid = t.oid
    where t.typname = 'user_role' and e.enumlabel = 'hospital'
  ) then
    alter type public.user_role add value 'hospital';
  end if;
end $$;

-- 2) Hospital user profile row (optional name storage)
create table if not exists public.hospital_users (
  user_id uuid primary key references public.profiles(user_id) on delete cascade,
  name text null,
  created_at timestamptz not null default now()
);

alter table public.hospital_users enable row level security;

drop policy if exists "hospital_users_select_own" on public.hospital_users;
create policy "hospital_users_select_own"
on public.hospital_users
for select
to authenticated
using (user_id = auth.uid());

drop policy if exists "hospital_users_insert_own" on public.hospital_users;
create policy "hospital_users_insert_own"
on public.hospital_users
for insert
to authenticated
with check (
  user_id = auth.uid()
  and exists (
    select 1 from public.profiles p
    where p.user_id = auth.uid() and p.role = 'hospital'
  )
);

drop policy if exists "hospital_users_update_own" on public.hospital_users;
create policy "hospital_users_update_own"
on public.hospital_users
for update
to authenticated
using (
  user_id = auth.uid()
  and exists (
    select 1 from public.profiles p
    where p.user_id = auth.uid() and p.role = 'hospital'
  )
)
with check (
  user_id = auth.uid()
  and exists (
    select 1 from public.profiles p
    where p.user_id = auth.uid() and p.role = 'hospital'
  )
);

-- 3) Emergency request lifecycle columns
alter table public.emergency_requests
  add column if not exists status text not null default 'open',
  add column if not exists hospital_user_id uuid null references public.profiles(user_id) on delete set null,
  add column if not exists expires_at timestamptz null,
  add column if not exists created_ip text null;

create index if not exists emergency_requests_status_idx
  on public.emergency_requests (status, created_at desc);

-- 4) RLS for lifecycle operations
drop policy if exists "emergencies_select_public" on public.emergency_requests;
create policy "emergencies_select_public"
on public.emergency_requests
for select
to public
using (true);

drop policy if exists "emergencies_insert_public" on public.emergency_requests;
create policy "emergencies_insert_public"
on public.emergency_requests
for insert
to public
with check (
  status = 'open'
  and hospital_user_id is null
);

drop policy if exists "emergencies_insert_hospital_open" on public.emergency_requests;
create policy "emergencies_insert_hospital_open"
on public.emergency_requests
for insert
to authenticated
with check (
  status = 'open'
  and hospital_user_id = auth.uid()
  and exists (
    select 1 from public.profiles p
    where p.user_id = auth.uid() and p.role = 'hospital'
  )
);

drop policy if exists "emergencies_update_admin" on public.emergency_requests;
create policy "emergencies_update_admin"
on public.emergency_requests
for update
to authenticated
using (public.is_admin())
with check (public.is_admin());

drop policy if exists "emergencies_update_hospital" on public.emergency_requests;
create policy "emergencies_update_hospital"
on public.emergency_requests
for update
to authenticated
using (
  hospital_user_id = auth.uid()
  and exists (
    select 1 from public.profiles p
    where p.user_id = auth.uid() and p.role = 'hospital'
  )
)
with check (
  hospital_user_id = auth.uid()
  and exists (
    select 1 from public.profiles p
    where p.user_id = auth.uid() and p.role = 'hospital'
  )
);

