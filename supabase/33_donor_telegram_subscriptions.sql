-- Per-donor Telegram subscriptions + one-time link code.

create table if not exists public.donor_telegram_subscriptions (
  donor_user_id uuid primary key references public.donors(user_id) on delete cascade,
  telegram_chat_id text not null,
  telegram_username text null,
  enabled boolean not null default true,
  verified_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.donor_telegram_link_codes (
  donor_user_id uuid primary key references public.donors(user_id) on delete cascade,
  code text not null unique,
  expires_at timestamptz not null,
  created_at timestamptz not null default now()
);

alter table public.donor_telegram_subscriptions enable row level security;
alter table public.donor_telegram_link_codes enable row level security;

drop policy if exists "donor_telegram_subscriptions_select_own" on public.donor_telegram_subscriptions;
create policy "donor_telegram_subscriptions_select_own"
on public.donor_telegram_subscriptions
for select
to authenticated
using (donor_user_id = auth.uid());

drop policy if exists "donor_telegram_subscriptions_upsert_own" on public.donor_telegram_subscriptions;
create policy "donor_telegram_subscriptions_upsert_own"
on public.donor_telegram_subscriptions
for insert
to authenticated
with check (donor_user_id = auth.uid());

drop policy if exists "donor_telegram_subscriptions_update_own" on public.donor_telegram_subscriptions;
create policy "donor_telegram_subscriptions_update_own"
on public.donor_telegram_subscriptions
for update
to authenticated
using (donor_user_id = auth.uid())
with check (donor_user_id = auth.uid());

drop policy if exists "donor_telegram_link_codes_select_own" on public.donor_telegram_link_codes;
create policy "donor_telegram_link_codes_select_own"
on public.donor_telegram_link_codes
for select
to authenticated
using (donor_user_id = auth.uid());

drop policy if exists "donor_telegram_link_codes_upsert_own" on public.donor_telegram_link_codes;
create policy "donor_telegram_link_codes_upsert_own"
on public.donor_telegram_link_codes
for insert
to authenticated
with check (donor_user_id = auth.uid());

drop policy if exists "donor_telegram_link_codes_update_own" on public.donor_telegram_link_codes;
create policy "donor_telegram_link_codes_update_own"
on public.donor_telegram_link_codes
for update
to authenticated
using (donor_user_id = auth.uid())
with check (donor_user_id = auth.uid());

