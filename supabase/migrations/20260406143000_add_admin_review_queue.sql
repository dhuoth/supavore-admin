create table if not exists public.admin_review_queue (
  id uuid primary key default gen_random_uuid(),
  review_type text not null,
  entity_type text not null,
  entity_id uuid not null,
  status text not null default 'pending',
  priority text not null default 'normal',
  source text null,
  summary text null,
  confidence numeric null,
  review_payload jsonb not null default '{}'::jsonb,
  decision_payload jsonb null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  resolved_at timestamptz null,
  resolved_by uuid null
);

create index if not exists admin_review_queue_status_idx
  on public.admin_review_queue (status);

create index if not exists admin_review_queue_type_status_idx
  on public.admin_review_queue (review_type, status);

create index if not exists admin_review_queue_entity_idx
  on public.admin_review_queue (entity_type, entity_id);

create unique index if not exists admin_review_queue_pending_unique_idx
  on public.admin_review_queue (review_type, entity_type, entity_id)
  where status = 'pending';

create or replace function public.set_admin_review_queue_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

drop trigger if exists set_admin_review_queue_updated_at on public.admin_review_queue;

create trigger set_admin_review_queue_updated_at
before update on public.admin_review_queue
for each row
execute function public.set_admin_review_queue_updated_at();

comment on table public.admin_review_queue is
  'Reusable admin review queue for low-confidence or review-required enrichments. All access must go through authenticated admin routes or service-role server code.';
