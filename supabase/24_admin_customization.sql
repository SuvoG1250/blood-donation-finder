-- Admin dashboard customization: persist UI prefs + editable email templates.

-- 1) Persist admin dashboard UI preferences per admin user.
create table if not exists public.admin_ui_prefs (
  user_id uuid primary key references public.admin_users(user_id) on delete cascade,
  eligibility_days int not null default 90,
  active_rows_limit int not null default 60,
  emergency_rows_limit int not null default 80,
  updated_at timestamptz not null default now()
);

alter table public.admin_ui_prefs enable row level security;

drop policy if exists "admin_ui_prefs_self_read" on public.admin_ui_prefs;
create policy "admin_ui_prefs_self_read"
on public.admin_ui_prefs
for select
to authenticated
using (user_id = auth.uid());

drop policy if exists "admin_ui_prefs_self_write" on public.admin_ui_prefs;
create policy "admin_ui_prefs_self_write"
on public.admin_ui_prefs
for insert
to authenticated
with check (user_id = auth.uid());

drop policy if exists "admin_ui_prefs_self_update" on public.admin_ui_prefs;
create policy "admin_ui_prefs_self_update"
on public.admin_ui_prefs
for update
to authenticated
using (user_id = auth.uid())
with check (user_id = auth.uid());

-- 2) Email templates editable by super admin.
create table if not exists public.email_templates (
  template_key text primary key,
  subject_template text not null,
  preheader_template text null,
  html_template text not null,
  text_template text not null,
  updated_at timestamptz not null default now()
);

alter table public.email_templates enable row level security;

drop policy if exists "email_templates_super_select" on public.email_templates;
create policy "email_templates_super_select"
on public.email_templates
for select
to authenticated
using (public.is_super_admin());

drop policy if exists "email_templates_super_upsert" on public.email_templates;
create policy "email_templates_super_upsert"
on public.email_templates
for insert
to authenticated
with check (public.is_super_admin());

drop policy if exists "email_templates_super_update" on public.email_templates;
create policy "email_templates_super_update"
on public.email_templates
for update
to authenticated
using (public.is_super_admin())
with check (public.is_super_admin());

