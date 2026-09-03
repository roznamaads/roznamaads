-- RoznamaAds.pk — B-R7 Seed: Institute/Company/Tender official sources
-- HEC (Institute/Admissions), SECP (Company/Business), PPRA (Tender/Supplier)
-- Real official URLs, verified via web search Sep 2026. Safe to re-run.

insert into public.verification_sources (name, authority, target_type, official_url, import_method, active, notes)
select 'HEC — Recognized Universities list', 'HEC', 'institute',
       'https://www.hec.gov.pk/english/universities/Pages/recognised.aspx', 'html', true,
       'Recognized universities/DAIs. Separate "Illegal/Fake" list also exists on HEC site. NOTE: university recognition does NOT mean every campus/program is recognized — check campus-level separately.'
where not exists (select 1 from public.verification_sources where name = 'HEC — Recognized Universities list');

insert into public.verification_sources (name, authority, target_type, official_url, import_method, active, notes)
select 'SECP — Company Verification Portal', 'SECP', 'company',
       'https://www.secp.gov.pk', 'html', true,
       'Company/registration-type signal only — presence/registration is NOT a "safe/trusted" guarantee. SECP also offers SMS verification (8181).'
where not exists (select 1 from public.verification_sources where name = 'SECP — Company Verification Portal');

insert into public.verification_sources (name, authority, target_type, official_url, import_method, active, notes)
select 'PPRA — Active Blacklisted/Debarred Firms', 'PPRA', 'tender',
       'https://epms.ppra.gov.pk/public/active-blacklisted-firms', 'html', true,
       'Federal PPRA active blacklist (firm, procuring agency, period, reason). Keep active vs historical/delisted separate per master plan section 4. Provincial PPRAs (Punjab/Sindh etc.) are separate sources to add later.'
where not exists (select 1 from public.verification_sources where name = 'PPRA — Active Blacklisted/Debarred Firms');
