-- ═══════════════════════════════════════════════════════════════════════════
-- S. Saeed & Co. — one notices table for IRIS notices, manual notices and appeals.
-- Run in Supabase → SQL Editor AFTER 001_iris.sql and the runner lockdown. Safe to run more than once.
-- ═══════════════════════════════════════════════════════════════════════════

alter table public.iris_notices
  add column if not exists kind          text  not null default 'notice',   -- notice | appeal
  add column if not exists source        text  not null default 'iris',     -- iris | manual
  add column if not exists forum         text,                              -- appeals: e.g. cira_127, atir_131
  add column if not exists order_date    date,                              -- appeals: date the order was served
  add column if not exists reference     text,                              -- notice / barcode / appeal number
  add column if not exists received_date date,
  add column if not exists officer       jsonb,                             -- {name, designation, unit, rto}
  add column if not exists draft         jsonb,                             -- the saved reply draft
  add column if not exists history       jsonb not null default '[]'::jsonb;

alter table public.iris_notices drop constraint if exists iris_notices_kind_check;
alter table public.iris_notices add  constraint iris_notices_kind_check   check (kind in ('notice','appeal'));
alter table public.iris_notices drop constraint if exists iris_notices_source_check;
alter table public.iris_notices add  constraint iris_notices_source_check check (source in ('iris','manual'));

-- stages: new, in_progress (Drafting), reply_drafted (Draft ready), in_review (new), submitted (Filed), closed, archived, not_ours
alter table public.iris_notices drop constraint if exists iris_notices_status_check;
alter table public.iris_notices add  constraint iris_notices_status_check
  check (status in ('new','in_progress','reply_drafted','in_review','submitted','closed','archived','not_ours'));

-- keep a history of every stage change
create or replace function public.iris_notices_history() returns trigger
language plpgsql as $$
begin
  if new.status is distinct from old.status then
    new.history := coalesce(old.history,'[]'::jsonb)
      || jsonb_build_object('on', now(), 'what', 'stage', 'from', old.status, 'to', new.status, 'by', new.updated_by);
  end if;
  return new;
end $$;
drop trigger if exists iris_notices_history_trg on public.iris_notices;
create trigger iris_notices_history_trg before update on public.iris_notices
  for each row execute function public.iris_notices_history();

create index if not exists iris_notices_kind_idx on public.iris_notices (kind);
