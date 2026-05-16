-- Allow staff admins to send district broadcasts when granted (super admin always can).

alter table public.admin_permissions
  add column if not exists can_broadcast boolean not null default false;

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
      when action = 'view_system_health' then coalesce(p.can_view_system_health, false)
      when action = 'broadcast' then coalesce(p.can_broadcast, false)
      else false
    end
  from (select auth.uid() as uid) u
  left join public.admin_permissions p
    on p.user_id = u.uid
$$;

grant execute on function public.admin_can(text) to authenticated;
