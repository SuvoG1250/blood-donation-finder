-- Store Web Push subscriptions for donors (VAPID)

create table if not exists public.donor_webpush_subscriptions (
  donor_user_id uuid primary key references public.profiles(user_id) on delete cascade,
  subscription jsonb not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists donor_webpush_subscriptions_donor_idx
  on public.donor_webpush_subscriptions (donor_user_id);

-- update updated_at (reuses existing trigger)
drop trigger if exists trg_donor_webpush_subscriptions_updated_at on public.donor_webpush_subscriptions;
create trigger trg_donor_webpush_subscriptions_updated_at
before update on public.donor_webpush_subscriptions
for each row execute function public.set_updated_at();

alter table public.donor_webpush_subscriptions enable row level security;

drop policy if exists "donor_webpush_subscriptions_self_select" on public.donor_webpush_subscriptions;
create policy "donor_webpush_subscriptions_self_select"
on public.donor_webpush_subscriptions
for select
to authenticated
using (donor_user_id = auth.uid());

drop policy if exists "donor_webpush_subscriptions_self_upsert" on public.donor_webpush_subscriptions;
create policy "donor_webpush_subscriptions_self_upsert"
on public.donor_webpush_subscriptions
for insert
to authenticated
with check (donor_user_id = auth.uid());

drop policy if exists "donor_webpush_subscriptions_self_update" on public.donor_webpush_subscriptions;
create policy "donor_webpush_subscriptions_self_update"
on public.donor_webpush_subscriptions
for update
to authenticated
using (donor_user_id = auth.uid())
with check (donor_user_id = auth.uid());

