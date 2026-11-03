-- ═══════════════════════════════════════════════════════════════════════════
-- S. Saeed & Co. staff portal — security upgrade (November 2026)
-- Run in Supabase → SQL Editor AFTER supabase-setup.sql and supabase-iris-runner-lockdown.sql.
-- Safe to run more than once.
--
-- What it does
--  1. Moves the encrypted client list out of the public portal page into a private table
--     (portal_vault) that only signed-in portal staff can read.
--  2. Requires two-step sign-in (authenticator app code, "aal2") for every portal staff
--     read/write. A stolen password alone no longer opens any client data.
--  3. Keeps a change history of the vault (admin-only).
-- The IRIS runner login (role 'runner') is NOT affected.
-- ═══════════════════════════════════════════════════════════════════════════

-- portal staff = listed in staff (not the runner) AND signed in with the authenticator code
create or replace function public.is_portal_staff() returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce(auth.jwt() ->> 'aal', '') = 'aal2'
     and exists (select 1 from staff
                 where lower(email) = lower(auth.jwt() ->> 'email')
                   and role in ('admin','reviewer','staff'));
$$;

create or replace function public.is_admin() returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce(auth.jwt() ->> 'aal', '') = 'aal2'
     and exists (select 1 from staff
                 where lower(email) = lower(auth.jwt() ->> 'email') and role = 'admin');
$$;

-- older policies used is_staff(); make it mean the same as is_portal_staff() OR the runner
create or replace function public.is_staff() returns boolean
language sql stable security definer set search_path = public as $$
  select public.is_portal_staff()
      or exists (select 1 from staff where lower(email) = lower(auth.jwt() ->> 'email') and role = 'runner');
$$;

-- 1. Encrypted client vault (one row)
create table if not exists public.portal_vault (
  id          int primary key default 1 check (id = 1),
  vault       jsonb not null,
  updated_at  timestamptz not null default now(),
  updated_by  text
);
create table if not exists public.portal_vault_history (
  id          bigserial primary key,
  vault       jsonb,
  changed_at  timestamptz not null default now(),
  changed_by  text
);
create or replace function public.log_portal_vault() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  insert into portal_vault_history(vault, changed_by) values (old.vault, old.updated_by);
  return new;
end $$;
drop trigger if exists portal_vault_history_trg on public.portal_vault;
create trigger portal_vault_history_trg before update or delete on public.portal_vault
  for each row execute function public.log_portal_vault();

alter table public.portal_vault         enable row level security;
alter table public.portal_vault_history enable row level security;
drop policy if exists vault_read   on public.portal_vault;
drop policy if exists vault_insert on public.portal_vault;
drop policy if exists vault_update on public.portal_vault;
drop policy if exists vhist_read   on public.portal_vault_history;
create policy vault_read   on public.portal_vault         for select to authenticated using (public.is_portal_staff());
create policy vault_insert on public.portal_vault         for insert to authenticated with check (public.is_admin());
create policy vault_update on public.portal_vault         for update to authenticated using (public.is_admin()) with check (public.is_admin());
create policy vhist_read   on public.portal_vault_history for select to authenticated using (public.is_admin());
-- no delete policy: the vault cannot be deleted from the app

-- 2. Nobody but staff may even list who the staff are (unchanged rule, re-stated with aal2)
drop policy if exists staff_read on public.staff;
create policy staff_read on public.staff for select to authenticated using (public.is_portal_staff());

-- Check afterwards, signed in through the portal:  select public.is_portal_staff();
