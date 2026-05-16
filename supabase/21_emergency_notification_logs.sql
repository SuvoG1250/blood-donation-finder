-- Log donor notification attempts per emergency request.
create table if not exists public.emergency_notification_logs (
  id bigserial primary key,
  request_id uuid not null references public.emergency_requests(request_id) on delete cascade,
  donor_user_id uuid null references public.profiles(user_id) on delete set null,
  donor_email text null,
  status text not null,
  error_message text null,
  created_at timestamptz not null default now()
);

do $$ begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'emergency_notification_logs_status_check'
  ) then
    alter table public.emergency_notification_logs
      add constraint emergency_notification_logs_status_check
      check (status in ('matched', 'sent', 'failed', 'skipped_no_email', 'provider_not_configured'));
  end if;
end $$;

create index if not exists emergency_notification_logs_request_idx
  on public.emergency_notification_logs (request_id, created_at desc);

alter table public.emergency_notification_logs enable row level security;

drop policy if exists "emergency_notification_logs_admin_read" on public.emergency_notification_logs;
create policy "emergency_notification_logs_admin_read"
on public.emergency_notification_logs
for select
to authenticated
using (public.is_admin());

drop policy if exists "emergency_notification_logs_donor_read_own" on public.emergency_notification_logs;
create policy "emergency_notification_logs_donor_read_own"
on public.emergency_notification_logs
for select
to authenticated
using (donor_user_id = auth.uid());

