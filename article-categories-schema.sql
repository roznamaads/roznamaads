-- RoznamaAds.pk — "article_categories" table — Schema + Seed
-- ---------------------------------------------------------------------------
-- Run this once in the Supabase SQL Editor to create the table, add RLS,
-- and seed the 5 confirmed categories (plan §9 — resolved).
-- Admin can add more categories later directly from Personal Toolkit
-- (Article Generator → "+ Naya Category Add Karein") — no redeploy needed.
-- ---------------------------------------------------------------------------

-- ============================================================
-- Table: article_categories
-- ============================================================
create table if not exists public.article_categories (
  id          uuid primary key default gen_random_uuid(),
  slug        text not null unique,   -- English, used as the value saved on articles.category
  label       text not null,          -- Display label (Urdu or English, shown in dropdown)
  created_at  timestamptz not null default now()
);

create index if not exists article_categories_slug_idx on public.article_categories (slug);

-- ============================================================
-- Row Level Security
-- ============================================================
-- Public (anon key): can SELECT only (so blog.html could show category labels if needed later)
-- Admin (service_role key, via api/admin/router.js): full access (bypasses RLS)

alter table public.article_categories enable row level security;

drop policy if exists "Public can read article categories" on public.article_categories;
create policy "Public can read article categories"
  on public.article_categories
  for select
  using (true);

-- ============================================================
-- Seed: 5 confirmed categories (plan §9, resolved this session)
-- ============================================================
insert into public.article_categories (slug, label) values
  ('visa-immigration',        'Visa/Immigration Alerts'),
  ('blacklist-tenders',       'Company & Tender Blacklist Updates'),
  ('education-hec',           'Education/HEC Updates'),
  ('housing-society-cda',     'Housing Society & CDA Updates'),
  ('govt-data-reports',       'Government Data Reports')
on conflict (slug) do nothing;
