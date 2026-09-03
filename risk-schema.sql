-- RoznamaAds.pk — Risk & Scam Checker Schema (Part B: additive on top of Part A)
-- ---------------------------------------------------------------------------
-- Additive only — does NOT modify supabase-schema.sql or verification-schema.sql.
-- Run this file in the Supabase SQL Editor to add Part B tables.
-- Ref: RoznamaAds v2 FINAL MASTER PLAN, sections 5.3 / 5.4 / 5.5 / 5.6.
-- ---------------------------------------------------------------------------

-- ============================================================
-- Table: risk_signals  (section 5.3)
-- Rule-based signals for any of the 9 target types. Never an AI/legal verdict.
-- ============================================================
create table if not exists public.risk_signals (
  id                uuid primary key default gen_random_uuid(),
  target_type       text not null,  -- 'society' | 'visa_agency' | 'job' | 'institute' | 'company' | 'tender' | 'auction' | 'phone' | 'url'
  target_reference  text not null,  -- free-text name/identifier of the target (e.g. society name, phone, URL)
  verification_id   uuid references public.verifications(id) on delete set null, -- optional link when target_type is society/visa_agency
  signal_type       text not null,  -- e.g. 'official_warning','status_mismatch','repeat_user_reports','advance_payment_claim'
  severity          text not null default 'caution', -- 'positive' | 'caution' | 'warning'
  reason            text,
  source_type       text not null, -- 'official' | 'roznamaads_internal' | 'user_report' | 'ai_suggested'
  source_url        text,
  status            text not null default 'pending', -- 'pending' | 'active' | 'dismissed' — only 'active' shows publicly
  reviewed_by       text,
  created_at        timestamptz not null default now()
);

create index if not exists risk_signals_target_type_idx on public.risk_signals (target_type);
create index if not exists risk_signals_status_idx      on public.risk_signals (status);
create index if not exists risk_signals_target_ref_idx  on public.risk_signals (target_reference);

-- ============================================================
-- Table: reports_risk  (section 5.4 — user reports, moderated)
-- ============================================================
create table if not exists public.reports_risk (
  id                  uuid primary key default gen_random_uuid(),
  target_type         text not null,
  target_reference    text not null,
  ad_id               uuid references public.ads(id) on delete set null,
  reason              text not null, -- 'Fake Job' | 'Fake Visa' | 'Property Fraud' | 'Advance Payment Demand' |
                                      -- 'Fake Company' | 'Fake Tender' | 'Fake Auction' | 'Wrong Contact' |
                                      -- 'Duplicate/Suspicious Ad' | 'Other'
  description         text,
  evidence_reference   text,          -- link/description of screenshots/receipts (subject to privacy controls)
  reporter_info        text,          -- optional, only what reporter chooses to share
  status               text not null default 'new', -- 'new' | 'under_review' | 'verified_concern' | 'dismissed' | 'resolved'
  admin_action         text,
  created_at            timestamptz not null default now(),
  reviewed_at            timestamptz
);

create index if not exists reports_risk_target_type_idx on public.reports_risk (target_type);
create index if not exists reports_risk_status_idx      on public.reports_risk (status);

-- ============================================================
-- Table: signals_phone  (section 5.5 — RoznamaAds' own ad data only, never telecom subscriber data)
-- ============================================================
create table if not exists public.signals_phone (
  id                       uuid primary key default gen_random_uuid(),
  normalized_phone         text not null unique,
  ads_count                integer not null default 0,
  distinct_advertiser_names integer not null default 0,
  categories                text[] default '{}',
  report_count              integer not null default 0,
  admin_flags                text,
  last_seen                  timestamptz,
  signal_status               text not null default 'unflagged', -- 'unflagged' | 'watch' | 'multiple_signals'
  updated_at                   timestamptz not null default now()
);

create index if not exists signals_phone_status_idx on public.signals_phone (signal_status);

-- ============================================================
-- Table: url_checks  (section 5.6)
-- ============================================================
create table if not exists public.url_checks (
  id                        uuid primary key default gen_random_uuid(),
  url_domain                text not null,
  https_basic_result        text,
  redirect_structure_result text,
  claimed_identity          text,
  official_match_signal     text,   -- 'match' | 'mismatch' | 'unknown'
  roznamaads_reports        integer not null default 0,
  risk_status                text not null default 'insufficient_information',
  last_checked                timestamptz not null default now()
);

create index if not exists url_checks_domain_idx on public.url_checks (url_domain);

-- ============================================================
-- Row Level Security
-- ============================================================
-- risk_signals: public can read only 'active' (moderated) signals; admin full access.
-- reports_risk: public can INSERT a report but never SELECT (protects reporter privacy); admin full access.
-- signals_phone / url_checks: admin/service_role only — public never reads these tables directly,
--   public checkers call Vercel serverless functions that compute/summarize on demand instead.

alter table public.risk_signals enable row level security;
alter table public.reports_risk enable row level security;
alter table public.signals_phone enable row level security;
alter table public.url_checks enable row level security;

drop policy if exists "public can read active risk signals" on public.risk_signals;
create policy "public can read active risk signals"
  on public.risk_signals for select
  using (status = 'active');

drop policy if exists "public can submit risk reports" on public.reports_risk;
create policy "public can submit risk reports"
  on public.reports_risk for insert
  with check (true);

-- No public policies on signals_phone or url_checks — admin-only via service_role.
