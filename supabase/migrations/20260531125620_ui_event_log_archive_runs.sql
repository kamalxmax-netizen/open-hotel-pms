begin;

create table if not exists public.ui_event_log_archive_runs (
  id uuid primary key default gen_random_uuid(),
  status text not null default 'started'
    check (status in ('started', 'succeeded', 'failed')),
  archive_cutoff_at timestamptz not null,
  retention_policy jsonb not null default '{}'::jsonb,
  r2_keys text[] not null default '{}'::text[],
  sha256_by_key jsonb not null default '{}'::jsonb,
  row_count integer not null default 0,
  archived_count integer not null default 0,
  deleted_count integer not null default 0,
  event_counts jsonb not null default '{}'::jsonb,
  category_counts jsonb not null default '{}'::jsonb,
  error_message text,
  started_at timestamptz not null default timezone('utc', now()),
  completed_at timestamptz,
  created_at timestamptz not null default timezone('utc', now())
);

alter table public.ui_event_log_archive_runs enable row level security;

alter table public.ui_event_logs
  add column if not exists archived_at timestamptz,
  add column if not exists archive_run_id uuid;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'ui_event_logs_archive_run_id_fkey'
  ) then
    alter table public.ui_event_logs
      add constraint ui_event_logs_archive_run_id_fkey
      foreign key (archive_run_id)
      references public.ui_event_log_archive_runs (id)
      on delete set null;
  end if;
end $$;

create index if not exists idx_ui_event_log_archive_runs_created
  on public.ui_event_log_archive_runs (created_at desc);

create index if not exists idx_ui_event_logs_archive_pending
  on public.ui_event_logs (created_at asc)
  where archived_at is null;

create index if not exists idx_ui_event_logs_archived_cleanup
  on public.ui_event_logs (created_at asc)
  where archived_at is not null;

commit;
