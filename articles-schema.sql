-- RoznamaAds.pk — "articles" table — Reference Schema (Supabase / PostgreSQL)
-- ---------------------------------------------------------------------------
-- This file is NOT auto-applied anywhere — it's a version-controlled record
-- of what the live Supabase "articles" table looks like, reverse-engineered
-- from actual usage across the codebase (api/admin/router.js — create-article
-- / list-articles / publish-article / delete-article — and article.html,
-- blog.html on the frontend).
--
-- NOTE: This table already exists live (created directly via Supabase SQL
-- Editor in an earlier session — the .sql file itself was never saved to the
-- repo, same gotcha as table_downloader_sources, see master plan §7 gotcha
-- #9). This file closes that documentation gap. Do NOT re-run this against
-- the live project as-is; "create table if not exists" is safe, but review
-- first if you're not sure the live table already matches.
--
-- If you ever need to rebuild the database from scratch (new Supabase
-- project, disaster recovery, staging environment), run this file in the
-- Supabase SQL Editor. If you change columns/policies in the live dashboard,
-- update this file to match so it stays trustworthy.
-- ---------------------------------------------------------------------------

-- ============================================================
-- Table: articles
-- ============================================================
create table if not exists public.articles (
  id            uuid primary key default gen_random_uuid(),
  title         text not null,                 -- Urdu script, SEO-friendly
  slug          text not null unique,           -- English, url-friendly (article.html?slug=...)
  summary       text,                           -- 1-2 line excerpt, also used as meta description
  body_html     text not null,                  -- full article HTML (h2/h3/p/ul/table etc.)
  category      text,                           -- currently hardcoded 'data-insights' from generator UI;
                                                 -- final category list still an open question (plan §9)
  source_label  text,                           -- human-readable source description (e.g. uploaded file names)
  source_url    text,                           -- optional link to source data, if applicable
  chart_data    jsonb,                          -- { type, labels, datasets } — rendered client-side via Chart.js
  word_count    integer,                        -- informational only, not enforced at save time
  published     boolean not null default false,
  published_at  timestamptz,                    -- set when publish-article action runs
  created_at    timestamptz not null default now()
);

create index if not exists articles_slug_idx        on public.articles (slug);
create index if not exists articles_published_idx   on public.articles (published);
create index if not exists articles_published_at_idx on public.articles (published_at desc);
create index if not exists articles_category_idx    on public.articles (category);

-- ============================================================
-- Row Level Security
-- ============================================================
-- Public (anon key) users:
--   - can SELECT from articles only where published = true
--     (used by article.html single-article view and blog.html "Data Insights" listing)
--   - CANNOT insert/update/delete
-- Admin (service_role key, used only inside Vercel serverless functions
--   via api/admin/router.js — create-article / publish-article / delete-article):
--   - full access (bypasses RLS automatically via service role)

alter table public.articles enable row level security;

drop policy if exists "Public can read published articles" on public.articles;
create policy "Public can read published articles"
  on public.articles
  for select
  using (published = true);

-- No insert/update/delete policy for anon — admin writes go through the
-- service_role key in api/admin/router.js, which bypasses RLS entirely.
