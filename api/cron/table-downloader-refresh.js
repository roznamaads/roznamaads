// Batch C — Scheduled Auto-Update for the Universal Table Downloader.
// Runs once a day (Vercel cron). For each ACTIVE saved source whose
// frequency interval has elapsed since last_run_at, re-fetches the site,
// dedupes, maps columns by HEADER NAME (not index — survives column
// reordering), and bulk-upserts into the same target table the interactive
// UI uses (on-conflict merge = existing rows get UPDATED, not duplicated).
//
// Honest limits (see Batch C plan):
// - Each source is capped at its own max_pages_per_run so one big site
//   can't blow the serverless timeout. If real end-of-pagination isn't
//   reached within that cap, the run is recorded as PARTIAL, not COMPLETED.
// - The whole invocation has a soft time budget; if it's close to running
//   out, remaining due sources are simply left for tomorrow's run instead
//   of risking a hard timeout mid-fetch.

import { runFullPaginatedJob, computeDedupeServer, mapRowsToTarget } from '../admin/_lib/table-downloader.js';

const TIME_BUDGET_MS = 50000; // leave headroom under Vercel's ~60s cap
const DELAY_MS = 700; // same polite default as the interactive tool

function sbHeaders() {
  return {
    apikey: process.env.SUPABASE_SERVICE_KEY,
    Authorization: `Bearer ${process.env.SUPABASE_SERVICE_KEY}`
  };
}
const SB = () => process.env.SUPABASE_URL;

const FREQUENCY_MS = {
  daily: 20 * 60 * 60 * 1000,    // >20h since last run = due (guards against slight cron-time drift)
  weekly: 6.5 * 24 * 60 * 60 * 1000,
  monthly: 27 * 24 * 60 * 60 * 1000
};

function isDue(source) {
  if (!source.last_run_at) return true;
  const elapsed = Date.now() - new Date(source.last_run_at).getTime();
  return elapsed >= (FREQUENCY_MS[source.frequency] || FREQUENCY_MS.monthly);
}

async function markRun(id, status, rows, message) {
  await fetch(`${SB()}/rest/v1/table_downloader_sources?id=eq.${encodeURIComponent(id)}`, {
    method: 'PATCH',
    headers: { ...sbHeaders(), 'Content-Type': 'application/json' },
    body: JSON.stringify({
      last_run_at: new Date().toISOString(),
      last_run_status: status,
      last_run_rows: rows,
      last_run_message: message
    })
  });
}

async function upsertVerifications(rows) {
  if (rows.length === 0) return;
  const nowIso = new Date().toISOString();
  const payload = rows.map(r => ({
    type: r.type,
    name: r.name,
    aliases: [],
    city: r.city || null,
    authority: r.authority,
    reference_no: r.reference_no || null,
    status: r.status || 'unknown',
    blacklist_status: null,
    last_verified: nowIso,
    official_source_url: r.official_source_url || null,
    notes: r.notes || null,
    published: r.published === true,
    updated_at: nowIso
  }));
  const r = await fetch(`${SB()}/rest/v1/verifications?on_conflict=authority,reference_no`, {
    method: 'POST',
    headers: { ...sbHeaders(), 'Content-Type': 'application/json', Prefer: 'resolution=merge-duplicates,return=minimal' },
    body: JSON.stringify(payload)
  });
  if (!r.ok) throw new Error(await r.text());
}

async function upsertTenders(rows) {
  if (rows.length === 0) return;
  const nowIso = new Date().toISOString();
  const payload = rows.map(r => ({
    tender_no: r.tender_no || null,
    title: r.title,
    organization: r.organization || null,
    authority: r.authority || 'PPRA',
    status: r.status || null,
    advertised_date: r.advertised_date || null,
    closing_date: r.closing_date || null,
    source_url: r.source_url || null,
    published: true,
    updated_at: nowIso
  }));
  const r = await fetch(`${SB()}/rest/v1/tenders?on_conflict=authority,tender_no`, {
    method: 'POST',
    headers: { ...sbHeaders(), 'Content-Type': 'application/json', Prefer: 'resolution=merge-duplicates,return=minimal' },
    body: JSON.stringify(payload)
  });
  if (!r.ok) throw new Error(await r.text());
}

export default async function handler(req, res) {
  if (req.headers['authorization'] !== `Bearer ${process.env.CRON_SECRET}`) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  const startedAt = Date.now();
  const results = [];

  try {
    const listRes = await fetch(`${SB()}/rest/v1/table_downloader_sources?active=eq.true&select=*`, { headers: sbHeaders() });
    const sources = await listRes.json();
    if (!Array.isArray(sources)) throw new Error('Could not load table_downloader_sources.');

    const due = sources.filter(isDue);

    for (const source of due) {
      if (Date.now() - startedAt > TIME_BUDGET_MS) {
        results.push({ id: source.id, name: source.name, status: 'SKIPPED_TIME_BUDGET' });
        continue; // left for tomorrow's run — not a failure, just not reached today
      }

      try {
        const job = await runFullPaginatedJob(source.url, source.max_pages_per_run || 20, DELAY_MS);
        if (!job.ok) {
          await markRun(source.id, 'FAILED', 0, job.message || job.reason || 'detect failed');
          results.push({ id: source.id, name: source.name, status: 'FAILED', message: job.message });
          continue;
        }

        const { uniqueRows } = computeDedupeServer(job.rows, job.headers);
        const mappedRows = mapRowsToTarget(job.headers, uniqueRows, source.mapping, source.target);

        if (source.target === 'tenders') await upsertTenders(mappedRows);
        else await upsertVerifications(mappedRows);

        const status = job.partial ? 'PARTIAL' : 'COMPLETED';
        const message = job.partial
          ? `Max pages (${source.max_pages_per_run}) reached before end-of-pagination — increase max pages or run manually for a full refresh.`
          : `${job.pagesFetched} pages, ${mappedRows.length} rows updated.`;
        await markRun(source.id, status, mappedRows.length, message);
        results.push({ id: source.id, name: source.name, status, rows: mappedRows.length });
      } catch (e) {
        await markRun(source.id, 'FAILED', 0, e.message);
        results.push({ id: source.id, name: source.name, status: 'FAILED', message: e.message });
      }
    }

    return res.status(200).json({ ok: true, dueCount: due.length, results });
  } catch (e) {
    return res.status(500).json({ error: e.message });
  }
}
