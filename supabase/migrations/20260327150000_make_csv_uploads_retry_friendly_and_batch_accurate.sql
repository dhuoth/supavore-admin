alter table public.upload_batches
  add column if not exists total_rows integer not null default 0,
  add column if not exists succeeded_rows integer not null default 0,
  add column if not exists failed_rows integer not null default 0,
  add column if not exists skipped_rows integer not null default 0,
  add column if not exists error_message text;

alter table public.upload_rows
  add column if not exists row_number integer,
  add column if not exists error_message text;

do $$
declare
  batch_constraint_name text;
begin
  select con.conname
    into batch_constraint_name
  from pg_constraint con
  join pg_class rel
    on rel.oid = con.conrelid
  join pg_namespace nsp
    on nsp.oid = rel.relnamespace
  where nsp.nspname = 'public'
    and rel.relname = 'upload_batches'
    and con.contype = 'c'
    and pg_get_constraintdef(con.oid) ilike '%status%';

  if batch_constraint_name is not null then
    execute format(
      'alter table public.upload_batches drop constraint %I',
      batch_constraint_name
    );
  end if;
end $$;

alter table public.upload_batches
  add constraint upload_batches_status_check
  check (status in ('processing', 'completed', 'completed_with_errors', 'error'));

do $$
declare
  row_constraint_name text;
begin
  select con.conname
    into row_constraint_name
  from pg_constraint con
  join pg_class rel
    on rel.oid = con.conrelid
  join pg_namespace nsp
    on nsp.oid = rel.relnamespace
  where nsp.nspname = 'public'
    and rel.relname = 'upload_rows'
    and con.contype = 'c'
    and pg_get_constraintdef(con.oid) ilike '%row_status%';

  if row_constraint_name is not null then
    execute format(
      'alter table public.upload_rows drop constraint %I',
      row_constraint_name
    );
  end if;
end $$;

alter table public.upload_rows
  add constraint upload_rows_row_status_check
  check (row_status in ('pending', 'succeeded', 'failed', 'skipped_duplicate'));
