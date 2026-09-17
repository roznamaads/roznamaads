-- RoznamaAds.pk — "sbp_series_bookmarks" table — Schema
-- ---------------------------------------------------------------------------
-- Run this once in the Supabase SQL Editor. Lets the admin save SBP EasyData
-- series keys permanently (from Article Generator → SBP EasyData → "+ Is
-- Series Ko Save Karein") instead of re-typing/re-pasting them every time.
-- ---------------------------------------------------------------------------

create table if not exists public.sbp_series_bookmarks (
  id          uuid primary key default gen_random_uuid(),
  series_key  text not null unique,   -- e.g. TS_GP_IR_SIRPR_AH.SBPOL0030
  label       text not null,          -- human-readable name, e.g. "Policy Rate"
  created_at  timestamptz not null default now()
);

create index if not exists sbp_series_bookmarks_key_idx on public.sbp_series_bookmarks (series_key);

alter table public.sbp_series_bookmarks enable row level security;

drop policy if exists "Public can read sbp series bookmarks" on public.sbp_series_bookmarks;
create policy "Public can read sbp series bookmarks"
  on public.sbp_series_bookmarks
  for select
  using (true);

-- No insert/update/delete policy for anon — admin writes go through the
-- service_role key in api/admin/router.js, which bypasses RLS entirely.
