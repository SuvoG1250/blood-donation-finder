-- Store donor device tokens for FCM Web Push (PWA)

create table if not exists public.donor_fcm_tokens (
  donor_user_id uuid primary key references public.profiles(user_id) on delete cascade,
  fcm_token text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists donor_fcm_tokens_token_idx
  on public.donor_fcm_tokens (fcm_token);

-- updated_at trigger (reuses existing public.set_updated_at trigger function)
drop trigger if exists trg_donor_fcm_tokens_updated_at on public.donor_fcm_tokens;
create trigger trg_donor_fcm_tokens_updated_at
before update on public.donor_fcm_tokens
for each row execute function public.set_updated_at();

alter table public.donor_fcm_tokens enable row level security;

drop policy if exists "donor_fcm_tokens_select_own" on public.donor_fcm_tokens;
create policy "donor_fcm_tokens_select_own"
on public.donor_fcm_tokens
for select
to authenticated
using (donor_user_id = auth.uid());

drop policy if exists "donor_fcm_tokens_upsert_own" on public.donor_fcm_tokens;
create policy "donor_fcm_tokens_upsert_own"
on public.donor_fcm_tokens
for insert
to authenticated
with check (
  donor_user_id = auth.uid()
);

drop policy if exists "donor_fcm_tokens_update_own" on public.donor_fcm_tokens;
create policy "donor_fcm_tokens_update_own"
on public.donor_fcm_tokens
for update
to authenticated
using (donor_user_id = auth.uid())
with check (donor_user_id = auth.uid());

