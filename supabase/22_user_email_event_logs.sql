-- Generic email audit log for user-facing lifecycle messages.
create table if not exists public.user_email_event_logs (
  id bigserial primary key,
  event_type text not null,
  actor_user_id uuid null references public.profiles(user_id) on delete set null,
  target_user_id uuid null references public.profiles(user_id) on delete set null,
  target_email text null,
  status text not null,
  error_message text null,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

do $$ begin
  if not exists (
    select 1 from pg_constraint where conname = 'user_email_event_logs_status_check'
  ) then
    alter table public.user_email_event_logs
      add constraint user_email_event_logs_status_check
      check (status in ('sent', 'failed', 'skipped'));
  end if;
end $$;

create index if not exists user_email_event_logs_created_idx
  on public.user_email_event_logs (created_at desc);

create index if not exists user_email_event_logs_event_idx
  on public.user_email_event_logs (event_type, created_at desc);

alter table public.user_email_event_logs enable row level security;

drop policy if exists "user_email_event_logs_admin_read" on public.user_email_event_logs;
create policy "user_email_event_logs_admin_read"
on public.user_email_event_logs
for select
to authenticated
using (public.is_admin());

