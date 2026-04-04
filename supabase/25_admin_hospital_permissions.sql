-- Admin + Hospital granular permissions (used to allow specific actions)

-- Admin permissions for staff/super admins.
create table if not exists public.admin_permissions (
  user_id uuid primary key references public.admin_users(user_id) on delete cascade,

  can_delete_donor boolean not null default false,
  can_delete_emergency boolean not null default false,
  can_update_emergency_status boolean not null default false,
  can_bulk_expire_open_emergencies boolean not null default false,
  can_resend_emergency_notify boolean not null default false,

  can_manage_admins boolean not null default false,
  can_view_audit_log boolean not null default false,
  can_preview_emergency_notifications boolean not null default false,
  can_send_mailjet_test_email boolean not null default false,
  can_edit_email_templates boolean not null default false,

  can_view_donor_lookup boolean not null default false,
  can_view_duplicate_contacts boolean not null default false,
  can_edit_site_settings boolean not null default false,

  updated_at timestamptz not null default now()
);

alter table public.admin_permissions enable row level security;

-- Permissions are only writable by admins that are super admins (server-side).
drop policy if exists "admin_permissions_super_select" on public.admin_permissions;
create policy "admin_permissions_super_select"
on public.admin_permissions
for select
to authenticated
using (public.is_super_admin());

-- Needed for admin_can() checks through RLS (client calls with anon key).
-- Admins can read their own capability row.
drop policy if exists "admin_permissions_self_select" on public.admin_permissions;
create policy "admin_permissions_self_select"
on public.admin_permissions
for select
to authenticated
using (user_id = auth.uid());

-- Hospital permissions (used inside emergency RLS).
create table if not exists public.hospital_permissions (
  user_id uuid primary key references public.hospital_users(user_id) on delete cascade,
  can_post_emergency boolean not null default true,
  can_update_own_emergency_status boolean not null default true,
  updated_at timestamptz not null default now()
);

alter table public.hospital_permissions enable row level security;

-- Hospitals can read their own permissions (for UI visibility).
drop policy if exists "hospital_permissions_self_select" on public.hospital_permissions;
create policy "hospital_permissions_self_select"
on public.hospital_permissions
for select
to authenticated
using (user_id = auth.uid());

-- Capability check function for admins (works in RLS and client RPC).
create or replace function public.admin_can(action text)
returns boolean
language sql
stable
as $$
  select
    case
      when public.is_super_admin() then true
      when action = 'delete_donor' then coalesce(p.can_delete_donor, false)
      when action = 'delete_emergency' then coalesce(p.can_delete_emergency, false)
      when action = 'update_emergency_status' then coalesce(p.can_update_emergency_status, false)
      when action = 'bulk_expire_open_emergencies' then coalesce(p.can_bulk_expire_open_emergencies, false)
      when action = 'resend_emergency_notify' then coalesce(p.can_resend_emergency_notify, false)
      when action = 'manage_admins' then coalesce(p.can_manage_admins, false)
      when action = 'view_audit_log' then coalesce(p.can_view_audit_log, false)
      when action = 'preview_emergency_notifications' then coalesce(p.can_preview_emergency_notifications, false)
      when action = 'send_mailjet_test_email' then coalesce(p.can_send_mailjet_test_email, false)
      when action = 'edit_email_templates' then coalesce(p.can_edit_email_templates, false)
      when action = 'view_donor_lookup' then coalesce(p.can_view_donor_lookup, false)
      when action = 'view_duplicate_contacts' then coalesce(p.can_view_duplicate_contacts, false)
      when action = 'edit_site_settings' then coalesce(p.can_edit_site_settings, false)
      else false
    end
  from public.admin_permissions p
  where p.user_id = auth.uid()
$$;

grant execute on function public.admin_can(text) to authenticated;

-- Hospital capability checks (defaults to true when no row exists to avoid breaking existing hospitals).
create or replace function public.hospital_can(action text)
returns boolean
language sql
stable
as $$
  select
    case
      when action = 'post_emergency' then coalesce(hp.can_post_emergency, true)
      when action = 'update_own_emergency_status' then coalesce(hp.can_update_own_emergency_status, true)
      else true
    end
  from public.hospital_permissions hp
  where hp.user_id = auth.uid()
$$;

grant execute on function public.hospital_can(text) to authenticated;

-- ---- RLS updates: Emergency status actions ----

-- Admins can update emergency status only if allowed.
drop policy if exists "emergencies_update_admin" on public.emergency_requests;
create policy "emergencies_update_admin"
on public.emergency_requests
for update
to authenticated
using (public.admin_can('update_emergency_status'))
with check (public.admin_can('update_emergency_status'));

-- Hospitals can post emergencies only if allowed.
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
  and public.hospital_can('post_emergency') = true
);

-- Hospitals can update their own emergency status only if allowed.
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
  and public.hospital_can('update_own_emergency_status') = true
)
with check (
  hospital_user_id = auth.uid()
  and exists (
    select 1 from public.profiles p
    where p.user_id = auth.uid() and p.role = 'hospital'
  )
  and public.hospital_can('update_own_emergency_status') = true
);

-- ---- Re-lock/extend admin-only RLS for audit + site settings ----

-- Super/admin audit log viewer
drop policy if exists "super_admin_audit_logs_super_read" on public.super_admin_audit_logs;
create policy "super_admin_audit_logs_super_read"
on public.super_admin_audit_logs
for select
to authenticated
using (public.admin_can('view_audit_log'));

-- Public site settings writer
drop policy if exists "public_site_settings_super_write" on public.public_site_settings;
create policy "public_site_settings_super_write"
on public.public_site_settings
for insert
to authenticated
with check (public.admin_can('edit_site_settings'));

drop policy if exists "public_site_settings_super_update" on public.public_site_settings;
create policy "public_site_settings_super_update"
on public.public_site_settings
for update
to authenticated
using (public.admin_can('edit_site_settings'))
with check (public.admin_can('edit_site_settings'));

-- Duplicate donor contacts RPC: replace the super-admin gate with permission gate.
create or replace function public.admin_list_duplicate_donor_contacts()
returns table (contact_number text, donor_count bigint)
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if not public.admin_can('view_duplicate_contacts') then
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

