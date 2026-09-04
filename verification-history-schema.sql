-- RoznamaAds.pk — Verification History (audit trail) — additive
-- Logs old vs new status/fields every time an admin updates a verifications row.
-- Run once in Supabase SQL Editor.

create table if not exists public.verification_history (
  id                uuid primary key default gen_random_uuid(),
  verification_id   uuid not null references public.verifications(id) on delete cascade,
  old_data          jsonb,
  new_data          jsonb,
  changed_at        timestamptz not null default now()
);

create index if not exists verification_history_vid_idx on public.verification_history (verification_id);

alter table public.verification_history enable row level security;
-- Admin/service_role only — no public policies (history is an internal admin tool).
