-- Super admin audit (inserts from service-role API only; RLS blocks anon writes)
create table if not exists public.super_admin_audit_logs (
  id bigserial primary key,
  actor_user_id uuid not null,
  action_type text not null,
  target_kind text null,
  target_id text null,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists super_admin_audit_logs_created_idx
  on public.super_admin_audit_logs (created_at desc);

create index if not exists super_admin_audit_logs_action_idx
  on public.super_admin_audit_logs (action_type, created_at desc);

alter table public.super_admin_audit_logs enable row level security;

drop policy if exists "super_admin_audit_logs_super_read" on public.super_admin_audit_logs;
create policy "super_admin_audit_logs_super_read"
on public.super_admin_audit_logs
for select
to authenticated
using (public.is_super_admin());

-- Public-facing copy (safe to expose on homepage)
create table if not exists public.public_site_settings (
  setting_key text primary key,
  setting_value text not null default '',
  updated_at timestamptz not null default now(),
  updated_by uuid null
);

alter table public.public_site_settings enable row level security;

drop policy if exists "public_site_settings_read" on public.public_site_settings;
create policy "public_site_settings_read"
on public.public_site_settings
for select
to anon, authenticated
using (true);

drop policy if exists "public_site_settings_super_write" on public.public_site_settings;
create policy "public_site_settings_super_write"
on public.public_site_settings
for insert
to authenticated
with check (public.is_super_admin());

drop policy if exists "public_site_settings_super_update" on public.public_site_settings;
create policy "public_site_settings_super_update"
on public.public_site_settings
for update
to authenticated
using (public.is_super_admin())
with check (public.is_super_admin());

insert into public.public_site_settings (setting_key, setting_value)
values
  ('support_whatsapp', ''),
  ('home_tagline', ''),
  ('home_support_note', ''),
  ('emergency_retention_days', '365')
on conflict (setting_key) do nothing;

-- Duplicate donor contacts (same phone used on multiple rows)
create or replace function public.admin_list_duplicate_donor_contacts()
returns table (contact_number text, donor_count bigint)
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if not public.is_super_admin() then
    raise exception 'forbidden';
  end if;
  return query
  select d.contact_number, count(*)::bigint
  from public.donors d
  where d.contact_number is not null
    and trim(d.contact_number) <> ''
  group by d.contact_number
  having count(*) > 1
  order by count(*) desc, d.contact_number
  limit 200;
end;
$$;

grant execute on function public.admin_list_duplicate_donor_contacts() to authenticated;
