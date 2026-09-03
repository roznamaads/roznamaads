-- RoznamaAds.pk — A-R4 Seed: Initial official verification sources
-- CDA (Society), RDA (Society), BEOE (Visa/OEP) — real official URLs, verified via web search Sep 2026.
-- Run once in Supabase SQL Editor. Safe to re-run (checks for existing name+authority first via NOT EXISTS).

insert into public.verification_sources (name, authority, target_type, official_url, import_method, active, notes)
select 'CDA — Private Housing Schemes (legal/illegal list)', 'CDA', 'society',
       'https://cda.gov.pk/public/privateCommercialProjects', 'html', true,
       'Two-tier approval: Layout Plan (LOP) approval, then NOC. Page lists Name, LOC status, NOC status per scheme.'
where not exists (select 1 from public.verification_sources where name = 'CDA — Private Housing Schemes (legal/illegal list)');

insert into public.verification_sources (name, authority, target_type, official_url, import_method, active, notes)
select 'RDA — Housing Societies (legal/illegal list)', 'RDA', 'society',
       'https://rda.gop.pk/housing-societies-2/', 'html', true,
       'RDA jurisdiction: Rawalpindi, Taxila, Gujar Khan, Murree, Kotli Sattian etc. Lists approved vs illegal/unapproved schemes.'
where not exists (select 1 from public.verification_sources where name = 'RDA — Housing Societies (legal/illegal list)');

insert into public.verification_sources (name, authority, target_type, official_url, import_method, active, notes)
select 'BEOE — List of OEPs (Overseas Employment Promoters)', 'BEOE', 'visa_agency',
       'https://beoe.gov.pk/list-of-oeps', 'html', true,
       'Licence number + status (valid/expired/cancelled/suspended/surrendered). Also see Blacklisted Technical Trade Centers page.'
where not exists (select 1 from public.verification_sources where name = 'BEOE — List of OEPs (Overseas Employment Promoters)');
