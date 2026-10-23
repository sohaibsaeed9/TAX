-- ═══════════════════════════════════════════════════════════════════════════
-- S. Saeed & Co. — keep the IRIS runner login away from the rest of the portal.
-- Run in Supabase → SQL Editor AFTER 001_iris.sql. Safe to run more than once.
--
-- Why: 001_iris.sql adds the runner as a row in the staff table, and is_staff() is true for any row.
-- That would let the runner login (its password sits in config.json on the office PC) read and
-- overwrite ALL portal data (invoices, fees, computations, filed returns) and every stored file.
-- This script limits the runner to the IRIS tables and to the 'iris/' folder of the notices bucket.
-- ═══════════════════════════════════════════════════════════════════════════

-- people who may use the portal itself (everyone in staff except the runner)
create or replace function public.is_portal_staff() returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from staff
                 where lower(email) = lower(auth.jwt() ->> 'email')
                   and role in ('admin','reviewer','staff'));
$$;

create or replace function public.is_runner() returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from staff
                 where lower(email) = lower(auth.jwt() ->> 'email') and role = 'runner');
$$;

-- portal data, change history and the staff list: portal staff only
drop policy if exists staff_read  on public.staff;
drop policy if exists data_read   on public.portal_data;
drop policy if exists data_insert on public.portal_data;
drop policy if exists data_update on public.portal_data;
create policy staff_read  on public.staff       for select to authenticated using (public.is_portal_staff());
create policy data_read   on public.portal_data for select to authenticated using (public.is_portal_staff());
create policy data_insert on public.portal_data for insert to authenticated with check (public.is_portal_staff());
create policy data_update on public.portal_data for update to authenticated using (public.is_portal_staff()) with check (public.is_portal_staff());
-- data_delete and hist_read already require is_admin(), which the runner is not.

-- stored files: portal staff see everything; the runner only reads/writes iris/...
drop policy if exists notices_read   on storage.objects;
drop policy if exists notices_insert on storage.objects;
drop policy if exists notices_update on storage.objects;
create policy notices_read   on storage.objects for select to authenticated using (
  bucket_id = 'notices' and (public.is_portal_staff() or (public.is_runner() and name like 'iris/%')));
create policy notices_insert on storage.objects for insert to authenticated with check (
  bucket_id = 'notices' and (public.is_portal_staff() or (public.is_runner() and name like 'iris/%')));
create policy notices_update on storage.objects for update to authenticated using (
  bucket_id = 'notices' and (public.is_portal_staff() or (public.is_runner() and name like 'iris/%')));
-- notices_delete already requires is_admin().

-- Check afterwards (should be: portal_staff = true for your own login, false for runner@...):
--   select public.is_portal_staff(), public.is_runner();
