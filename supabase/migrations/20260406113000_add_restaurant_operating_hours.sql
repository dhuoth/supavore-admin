alter table public.restaurants
  add column if not exists google_place_id text,
  add column if not exists hours_source text,
  add column if not exists hours_last_synced_at timestamptz,
  add column if not exists hours_sync_status text,
  add column if not exists hours_match_confidence numeric,
  add column if not exists hours_notes text,
  add column if not exists timezone text,
  add column if not exists place_name_from_source text,
  add column if not exists hours_is_manually_managed boolean not null default false;

create table if not exists public.restaurant_hours (
  id uuid primary key default gen_random_uuid(),
  restaurant_id uuid not null references public.restaurants(id) on delete cascade,
  day_of_week int not null,
  open_time_local time null,
  close_time_local time null,
  is_closed boolean not null default false,
  window_index int not null default 1,
  source text null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'restaurant_hours_day_of_week_check'
  ) then
    alter table public.restaurant_hours
      add constraint restaurant_hours_day_of_week_check
      check (day_of_week between 0 and 6);
  end if;

  if not exists (
    select 1
    from pg_constraint
    where conname = 'restaurant_hours_window_index_check'
  ) then
    alter table public.restaurant_hours
      add constraint restaurant_hours_window_index_check
      check (window_index >= 1);
  end if;

  if not exists (
    select 1
    from pg_constraint
    where conname = 'restaurant_hours_restaurant_day_window_key'
  ) then
    alter table public.restaurant_hours
      add constraint restaurant_hours_restaurant_day_window_key
      unique (restaurant_id, day_of_week, window_index);
  end if;
end;
$$;

create index if not exists restaurant_hours_restaurant_id_idx
  on public.restaurant_hours (restaurant_id);

create index if not exists restaurant_hours_restaurant_day_idx
  on public.restaurant_hours (restaurant_id, day_of_week);

create or replace function public.set_restaurant_hours_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

drop trigger if exists set_restaurant_hours_updated_at on public.restaurant_hours;

create trigger set_restaurant_hours_updated_at
before update on public.restaurant_hours
for each row
execute function public.set_restaurant_hours_updated_at();

comment on table public.restaurant_hours is
  'Structured restaurant operating hours. No direct client Supabase reads or writes in this step; use authenticated admin API routes or service-role server code.';

comment on column public.restaurants.hours_is_manually_managed is
  'When true, Google refresh and backfill must not overwrite persisted restaurant_hours unless an explicit force refresh is requested.';

comment on column public.restaurants.hours_sync_status is
  'Latest hours sync outcome. Existing persisted hours remain untouched unless the sync result is matched_with_hours or a manual admin save replaces them.';
