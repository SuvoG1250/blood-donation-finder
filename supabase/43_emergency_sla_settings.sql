-- Site settings keys for emergency SLA thresholds.
-- Used by /api/cron/emergency-sla with env fallback.

insert into public.public_site_settings (setting_key, setting_value)
values
  ('emergency_sla_open_minutes', '30'),
  ('emergency_sla_verify_pending_minutes', '20')
on conflict (setting_key) do nothing;
