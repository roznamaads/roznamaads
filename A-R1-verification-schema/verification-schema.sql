-- RoznamaAds.pk — Verification Schema (Part A: Society/Visa Verification)
-- ---------------------------------------------------------------------------
-- Additive to supabase-schema.sql — does NOT modify/replace ads or ad_reports.
-- Run this file in the Supabase SQL Editor to add verification tables.
-- Ref: RoznamaAds v2 FINAL MASTER PLAN, sections 5.1 / 5.2 / 13 (Part A base).
-- ---------------------------------------------------------------------------

-- ============================================================
-- Table: verifications  (core record — Society/Property + Visa/OEP)
-- ============================================================
create table if not exists public.verifications (
  id                  uuid primary key default gen_random_uuid(),
  type                text not null,              -- 'society' | 'visa_agency'
  name                text not null,
  aliases             text[] default '{}',
  city                text,
  authority           text not null,              -- e.g. 'CDA', 'RDA', 'BEOE'
  reference_no        text,                        -- scheme no. / licence no.
  status              text not null,               -- e.g. 'approved','unapproved','illegal','warning','unknown','stale',
                                                     -- 'valid','invalid','expired','cancelled','surrendered'
  blacklist_status     text,                        -- null | 'blacklisted' | other authority-specific flag
  last_verified        timestamptz,                 -- when RoznamaAds admin last confirmed against source
  official_source_url  text,
  notes                text,
  published            boolean not null default false, -- gate for public visibility (admin approves before public sees it)
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now()
);

create index if not exists verifications_type_idx      on public.verifications (type);
create index if not exists verifications_city_idx      on public.verifications (city);
create index if not exists verifications_status_idx    on public.verifications (status);
create index if not exists verifications_published_idx on public.verifications (published);
create index if not exists verifications_name_idx      on public.verifications using gin (to_tsvector('simple', name));

-- ============================================================
-- Table: verification_sources  (source governance — section 3.3)
-- ============================================================
create table if not exists public.verification_sources (
  id              uuid primary key default gen_random_uuid(),
  name            text not null,               -- human label, e.g. "CDA official scheme list"
  authority       text not null,               -- 'CDA' | 'RDA' | 'BEOE' | ...
  target_type     text not null,               -- 'society' | 'visa_agency'
  official_url    text not null,
  import_method   text not null default 'manual', -- 'api' | 'html' | 'pdf' | 'manual'
  active          boolean not null default true,
  last_checked    timestamptz,
  next_check      timestamptz,
  notes           text,
  created_at      timestamptz not null default now()
);

create index if not exists verification_sources_target_type_idx on public.verification_sources (target_type);
create index if not exists verification_sources_active_idx      on public.verification_sources (active);

-- ============================================================
-- Row Level Security
-- ============================================================
-- Public (anon key):
--   - can SELECT from verifications only where published = true
--   - NO access to verification_sources (admin/internal only)
-- Admin (service_role key, inside Vercel serverless functions only):
--   - full access, bypasses RLS entirely

alter table public.verifications enable row level security;
alter table public.verification_sources enable row level security;

drop policy if exists "public can read published verifications" on public.verifications;
create policy "public can read published verifications"
  on public.verifications for select
  using (published = true);

-- No public policies on verification_sources — admin-only via service_role.
