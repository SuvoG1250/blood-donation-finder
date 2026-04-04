-- Telegram settings + templates (editable from admin settings page).

insert into public.public_site_settings (setting_key, setting_value)
values
  ('telegram_enabled', 'false'),
  (
    'telegram_emergency_template',
    '🚨 Emergency Blood Request%0ABlood group: {{blood_group}}%0ALocation: {{district}} / {{block}} / {{panchayat}}%0A{{patient_line}}%0A{{contact_line}}%0A{{details_line}}'
  ),
  (
    'telegram_reminder_template',
    '🩸 Hello {{name}}, you are now eligible to donate again. Thank you for supporting Raktodaan.'
  )
on conflict (setting_key) do nothing;

