-- SLA auto-escalation marker (set by cron when thresholds are breached).
alter table public.emergency_requests
  add column if not exists escalated_at timestamptz null;

comment on column public.emergency_requests.escalated_at is
  'Set once when an open or verification-SLA breach is detected (cron).';

create index if not exists emergency_requests_escalation_cron_idx
  on public.emergency_requests (escalated_at, status, created_at desc)
  where escalated_at is null;
