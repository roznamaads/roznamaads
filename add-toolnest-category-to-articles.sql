-- RoznamaAds.pk — add "toolnest_category" column to articles table
-- ---------------------------------------------------------------------------
-- Run this once in the Supabase SQL Editor. Lets each article optionally
-- link to a relevant ToolNest.link tool (same cross-promotion widget already
-- used on ad.html), shown on article.html via a small widget.
--
-- Valid values match the existing toolnest-tools.json category keys:
-- property, jobs, matrimonial, electronics, services, visa, auctions,
-- admissions, tenders. Leave NULL/empty for no widget on that article.
-- ---------------------------------------------------------------------------

alter table public.articles
  add column if not exists toolnest_category text;
