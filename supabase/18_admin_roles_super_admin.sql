-- Admin role model: staff vs super_admin
-- super_admin can run destructive/bulk admin actions.

alter table public.admin_users
  add column if not exists admin_role text not null default 'staff';

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'admin_users_admin_role_check'
  ) then
    alter table public.admin_users
      add constraint admin_users_admin_role_check
      check (admin_role in ('staff', 'super_admin'));
  end if;
end $$;

create or replace function public.is_super_admin()
returns boolean
language sql
stable
as $$
  select exists (
    select 1
    from public.admin_users a
    where a.user_id = auth.uid()
      and a.admin_role = 'super_admin'
  )
$$;

grant execute on function public.is_super_admin() to authenticated;

