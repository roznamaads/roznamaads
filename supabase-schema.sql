-- RoznamaAds.pk — Reference Database Schema (Supabase / PostgreSQL)
-- ---------------------------------------------------------------------------
-- This file is NOT auto-applied anywhere — it's a version-controlled record
-- of what the live Supabase tables/policies look like, reverse-engineered
-- from actual usage across the codebase (submit-ad.html, ad.html,
-- api/admin/router.js, api/cron/expire-ads.js, admin/personal-toolkit.html).
--
-- If you ever need to rebuild the database from scratch (new Supabase
-- project, disaster recovery, staging environment), run this file in the
-- Supabase SQL Editor. If you change columns/policies in the live dashboard,
-- update this file to match so it stays trustworthy.
-- ---------------------------------------------------------------------------

-- ============================================================
-- Table: ads
-- ============================================================
create table if not exists public.ads (
  id              uuid primary key default gen_random_uuid(),
  category        text not null,              -- must be one of VALID_CATEGORIES in api/admin/router.js
  title           text not null,
  city            text,
  price           text,                       -- free text, e.g. "160 KD", "45 Lac", "" if not applicable
  description     text,
  contact_phone   text,
  images          text[] default '{}',        -- array of public Supabase Storage URLs (ad-images bucket)
  extra_fields    jsonb default '{}'::jsonb,   -- category-specific structured data, e.g. { table: {headers, rows}, deadline: '...' }
  submitted_name  text,                        -- optional, set for public user submissions / AI drafts
  status          text not null default 'pending', -- 'pending' | 'live' | 'expired' | 'rejected'
  expires_at      timestamptz,                 -- set on publish/approve; cron expires past this date
  created_at      timestamptz not null default now()
);

create index if not exists ads_status_idx        on public.ads (status);
create index if not exists ads_category_idx      on public.ads (category);
create index if not exists ads_city_idx          on public.ads (city);
create index if not exists ads_created_at_idx    on public.ads (created_at desc);
create index if not exists ads_expires_at_idx    on public.ads (expires_at);
create index if not exists ads_contact_phone_idx on public.ads (contact_phone);

-- ============================================================
-- Table: ad_reports  ("Report this ad" — Reported Ads queue)
-- ============================================================
create table if not exists public.ad_reports (
  id           uuid primary key default gen_random_uuid(),
  ad_id        uuid references public.ads(id) on delete cascade,
  reason       text,
  reported_at  timestamptz not null default now()
);

create index if not exists ad_reports_ad_id_idx on public.ad_reports (ad_id);

-- ============================================================
-- Row Level Security
-- ============================================================
-- Public (anon key) users:
--   - can INSERT into ads (Submit Ad form) — always as status='pending', never 'live'
--   - can SELECT from ads only where status = 'live' (public listing pages)
--   - can INSERT into ad_reports (Report this ad button)
--   - CANNOT update/delete anything, CANNOT select 'pending'/'rejected' ads
-- Admin (service_role key, used only inside Vercel serverless functions):
--   - full access, bypasses RLS entirely (never exposed to the browser)

alter table public.ads enable row level security;
alter table public.ad_reports enable row level security;

drop policy if exists "public can read live ads" on public.ads;
create policy "public can read live ads"
  on public.ads for select
  using (status = 'live');

drop policy if exists "public can submit pending ads" on public.ads;
create policy "public can submit pending ads"
  on public.ads for insert
  with check (status = 'pending');

drop policy if exists "public can report ads" on public.ad_reports;
create policy "public can report ads"
  on public.ad_reports for insert
  with check (true);

-- ============================================================
-- Storage bucket: ad-images (public read, anon can upload)
-- ============================================================
-- Created via Supabase dashboard → Storage. Documented here for reference:
--   - Bucket name: ad-images
--   - Public: yes (so <img src> works directly without signed URLs)
--   - Anon key can upload (used by submit-ad.html and Ad Post Generator)
