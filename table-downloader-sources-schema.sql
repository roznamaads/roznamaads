-- Saved Sources (Universal Table Downloader automation registry)
-- Missing migration — required for save-source / list-sources / toggle-source /
-- delete-source (api/admin/router.js) and the daily cron
-- (api/cron/table-downloader-refresh.js) to work.

create table if not exists public.table_downloader_sources (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  url text not null,
  target text not null check (target in ('verifications', 'tenders')),
  frequency text not null check (frequency in ('daily', 'weekly', 'monthly')),
  mapping jsonb not null,
  max_pages_per_run integer not null default 20,
  active boolean not null default true,
  last_run_at timestamptz,
  last_run_status text,
  last_run_rows integer,
  last_run_message text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- Admin-only table (accessed via service_role key from serverless functions only,
-- same pattern as other admin tables) — RLS on, no public policy.
alter table public.table_downloader_sources enable row level security;
