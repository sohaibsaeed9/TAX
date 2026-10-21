-- S. Saeed & Co. staff portal - Supabase setup
-- Paste into Supabase: SQL Editor -> New query -> Run. Safe to run more than once.

-- 1. Who may use the portal (one row per staff login)
create table if not exists public.staff (
  email     text primary key,
  username  text unique not null,
  name      text not null,
  role      text not null check (role in ('admin','reviewer','staff'))
);

-- 2. Portal data: one row per saved data set (invoices, fees, tasks, notices, ...)
create table if not exists public.portal_data (
  key         text primary key check (key like 'sc\_%'),
  value       text not null,
  updated_at  timestamptz not null default now(),
  updated_by  text
);

-- 3. Change history so nothing is ever silently lost
create table if not exists public.portal_data_history (
  id          bigserial primary key,
  key         text not null,
  value       text,
  changed_at  timestamptz not null default now(),
  changed_by  text
);

create or replace function public.log_portal_data() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  insert into portal_data_history(key, value, changed_by) values (old.key, old.value, old.updated_by);
  return new;
end $$;

drop trigger if exists portal_data_history_trg on public.portal_data;
create trigger portal_data_history_trg before update or delete on public.portal_data
  for each row execute function public.log_portal_data();

-- 4. Security: only logged-in people listed in staff can read or write
create or replace function public.is_staff() returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from staff where lower(email) = lower(auth.jwt() ->> 'email'));
$$;

create or replace function public.is_admin() returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from staff where lower(email) = lower(auth.jwt() ->> 'email') and role = 'admin');
$$;

alter table public.staff               enable row level security;
alter table public.portal_data         enable row level security;
alter table public.portal_data_history enable row level security;

drop policy if exists staff_read  on public.staff;
drop policy if exists data_read   on public.portal_data;
drop policy if exists data_insert on public.portal_data;
drop policy if exists data_update on public.portal_data;
drop policy if exists data_delete on public.portal_data;
drop policy if exists hist_read   on public.portal_data_history;

create policy staff_read  on public.staff               for select to authenticated using (public.is_staff());
create policy data_read   on public.portal_data         for select to authenticated using (public.is_staff());
create policy data_insert on public.portal_data         for insert to authenticated with check (public.is_staff());
create policy data_update on public.portal_data         for update to authenticated using (public.is_staff()) with check (public.is_staff());
create policy data_delete on public.portal_data         for delete to authenticated using (public.is_admin());
create policy hist_read   on public.portal_data_history for select to authenticated using (public.is_admin());

-- 5. Live updates between computers
do $$ begin
  alter publication supabase_realtime add table public.portal_data;
exception when duplicate_object then null; end $$;

-- 6. Staff list - edit the emails, then run again
-- To add someone later, add a line like:  ('their@email.com', 'ubaid', 'Ubaid', 'reviewer'),
insert into public.staff (email, username, name, role) values
  ('sohaib@saeedandcotax.com', 'sohaib', 'Sohaib', 'admin')
on conflict (email) do update set username = excluded.username, name = excluded.name, role = excluded.role;
