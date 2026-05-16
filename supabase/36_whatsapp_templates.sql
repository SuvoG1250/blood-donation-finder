-- WhatsApp message templates for donor contact buttons

insert into public.public_site_settings (setting_key, setting_value)
values
  (
    'whatsapp_emergency_template',
    'Hello {{donor_name}}, I am {{requester}}. I need {{blood_group}} blood donor support in {{district}}, {{block}}{{panchayat_line}}{{village_line}}.'
  ),
  (
    'whatsapp_query_template',
    'Hello {{donor_name}}, I am {{requester}}. Are you available to donate {{blood_group}} blood? Location: {{district}}, {{block}}{{panchayat_line}}{{village_line}}.'
  ),
  (
    'whatsapp_availability_template',
    'Hello {{donor_name}}, I am {{requester}}. Please tell me when you can donate (day/time). Needed: {{blood_group}}. Location: {{district}}, {{block}}{{panchayat_line}}{{village_line}}.'
  )
on conflict (setting_key) do nothing;

