-- Fix: admin_can()/hospital_can() must return defaults even when no permission rows exist.

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
      else false
    end
  from (select auth.uid() as uid) u
  left join public.admin_permissions p
    on p.user_id = u.uid
$$;

grant execute on function public.admin_can(text) to authenticated;

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
  from (select auth.uid() as uid) u
  left join public.hospital_permissions hp
    on hp.user_id = u.uid
$$;

grant execute on function public.hospital_can(text) to authenticated;

