create or replace function public.sync_upload_row_status()
returns trigger
language plpgsql
as $$
begin
  if new.row_status <> 'skipped_duplicate' then
    if nullif(btrim(coalesce(new.error_message, '')), '') is not null then
      new.row_status := 'failed';
    elsif new.row_status = 'pending'
      and nullif(btrim(coalesce(new.linked_menu_item_id::text, '')), '') is not null then
      new.row_status := 'succeeded';
    end if;
  end if;

  return new;
end;
$$;

create or replace function public.reconcile_upload_batch_status(target_batch_id uuid)
returns void
language plpgsql
as $$
declare
  total_count integer := 0;
  succeeded_count integer := 0;
  failed_count integer := 0;
  skipped_count integer := 0;
  pending_count integer := 0;
begin
  select
    count(*)::integer,
    (count(*) filter (where row_status = 'succeeded'))::integer,
    (count(*) filter (where row_status = 'failed'))::integer,
    (count(*) filter (where row_status = 'skipped_duplicate'))::integer,
    (count(*) filter (where row_status = 'pending'))::integer
  into
    total_count,
    succeeded_count,
    failed_count,
    skipped_count,
    pending_count
  from public.upload_rows
  where batch_id = target_batch_id;

  update public.upload_batches
  set total_rows = total_count,
      succeeded_rows = succeeded_count,
      failed_rows = failed_count,
      skipped_rows = skipped_count,
      status = case
        when nullif(btrim(coalesce(error_message, '')), '') is not null then 'error'
        when total_count = 0 then 'processing'
        when pending_count > 0 then 'processing'
        when failed_count > 0 and succeeded_count = 0 then 'error'
        when failed_count > 0 or skipped_count > 0 then 'completed_with_errors'
        when succeeded_count = total_count then 'completed'
        else 'processing'
      end
  where id = target_batch_id;
end;
$$;

create or replace function public.reconcile_upload_batch_status_from_row()
returns trigger
language plpgsql
as $$
begin
  if tg_op = 'DELETE' then
    perform public.reconcile_upload_batch_status(old.batch_id);
    return old;
  end if;

  if tg_op = 'UPDATE' and old.batch_id is distinct from new.batch_id then
    perform public.reconcile_upload_batch_status(old.batch_id);
  end if;

  perform public.reconcile_upload_batch_status(new.batch_id);
  return new;
end;
$$;

drop trigger if exists sync_upload_row_status_before_write on public.upload_rows;

create trigger sync_upload_row_status_before_write
before insert or update of row_status, error_message, linked_menu_item_id
on public.upload_rows
for each row
execute function public.sync_upload_row_status();

drop trigger if exists reconcile_upload_batch_status_after_row_write on public.upload_rows;

create trigger reconcile_upload_batch_status_after_row_write
after insert or update or delete
on public.upload_rows
for each row
execute function public.reconcile_upload_batch_status_from_row();

update public.upload_rows
set row_status = case
  when row_status = 'skipped_duplicate' then 'skipped_duplicate'
  when nullif(btrim(coalesce(error_message, '')), '') is not null then 'failed'
  when row_status = 'pending'
    and nullif(btrim(coalesce(linked_menu_item_id::text, '')), '') is not null then 'succeeded'
  else row_status
end;

do $$
declare
  batch_record record;
begin
  for batch_record in
    select id
    from public.upload_batches
  loop
    perform public.reconcile_upload_batch_status(batch_record.id);
  end loop;
end;
$$;
