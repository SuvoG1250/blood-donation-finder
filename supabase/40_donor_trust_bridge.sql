-- Super admin donor trust bridge / badge support.

alter table public.donors
  add column if not exists is_trusted boolean not null default false;

create index if not exists donors_is_trusted_idx
  on public.donors (is_trusted);
