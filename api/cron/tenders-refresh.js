// Daily cron: auto-refreshes PPRA Active Tenders into the `tenders` table.
// No manual button-press needed — Vercel Cron triggers this once a day.
// Reuses the same safe-fetch / table-extraction logic as the Universal
// Table Downloader (api/admin/_lib/table-downloader.js), just driven
// server-side in a loop instead of one page at a time from the browser.

import { fetchSinglePage } from '../admin/_lib/table-downloader.js';

const BASE_URL = 'https://epms.ppra.gov.pk/public/tenders/active-tenders';
const TABLE_INDEX = 0;
// Column order confirmed manually via Table Downloader on 2026-09-09:
// Sr | Tender No | Tender Details | Organization Details | Status | Advertised | Closing | Actions
const COL = { tenderNo: 1, title: 2, org: 3, status: 4, advertised: 5, closing: 6 };
const MAX_PAGES = 60; // safety cap — site currently has ~41 pages
const DELAY_MS = 200;

function SB() { return process.env.SUPABASE_URL; }
function sbHeaders() {
  return {
    apikey: process.env.SUPABASE_SERVICE_KEY,
    Authorization: `Bearer ${process.env.SUPABASE_SERVICE_KEY}`
  };
}

export default async function handler(req, res) {
  // Vercel automatically sends this header for scheduled Cron invocations
  // when CRON_SECRET env var is set.
  if (req.headers['authorization'] !== `Bearer ${process.env.CRON_SECRET}`) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  const allRows = [];
  let pagesFetched = 0;
  let headerVerified = false;

  try {
    for (let page = 1; page <= MAX_PAGES; page++) {
      const targetUrl = page === 1 ? BASE_URL : `${BASE_URL}?page=${page}`;
      const result = await fetchSinglePage(targetUrl, TABLE_INDEX, 'query_param');

      if (!result.ok) {
        return res.status(500).json({
          error: `Page ${page} fetch failed: ${result.message || result.reason}`,
          pagesFetched, rowsCollected: allRows.length
        });
      }

      // Guard: if PPRA changes their table's column order/layout, stop
      // instead of silently importing garbage into the wrong fields.
      if (!headerVerified) {
        const h = result.headers.map(x => (x || '').trim().toLowerCase());
        const looksRight = (h[COL.tenderNo] || '').includes('tender no') && (h[COL.title] || '').includes('tender detail');
        if (!looksRight) {
          return res.status(500).json({
            error: 'PPRA page structure badal gaya hai (column order match nahi hua) — manual re-check zaroori hai, auto-import rok diya.',
            gotHeaders: result.headers
          });
        }
        headerVerified = true;
      }

      if (result.isEmpty) break;
      result.rows.forEach(cells => allRows.push(cells));
      pagesFetched++;

      if (page < MAX_PAGES) await new Promise(r => setTimeout(r, DELAY_MS));
    }
  } catch (e) {
    return res.status(500).json({ error: 'Fetch loop error: ' + e.message, pagesFetched, rowsCollected: allRows.length });
  }

  const nowIso = new Date().toISOString();
  const payload = allRows
    .filter(r => (r[COL.title] || '').trim())
    .map(r => ({
      tender_no: r[COL.tenderNo] || null,
      title: r[COL.title],
      organization: r[COL.org] || null,
      authority: 'PPRA',
      status: r[COL.status] || null,
      advertised_date: r[COL.advertised] || null,
      closing_date: r[COL.closing] || null,
      source_url: BASE_URL,
      raw_details: JSON.stringify(r),
      published: true,
      updated_at: nowIso
    }));

  let upserted = 0;
  const CHUNK = 300;
  try {
    for (let i = 0; i < payload.length; i += CHUNK) {
      const chunk = payload.slice(i, i + CHUNK);
      const r = await fetch(`${SB()}/rest/v1/tenders?on_conflict=authority,tender_no`, {
        method: 'POST',
        headers: { ...sbHeaders(), 'Content-Type': 'application/json', Prefer: 'resolution=merge-duplicates,return=minimal' },
        body: JSON.stringify(chunk)
      });
      if (!r.ok) {
        const errText = await r.text();
        return res.status(500).json({
          error: 'Supabase upsert failed: ' + errText,
          pagesFetched, rowsCollected: allRows.length, upsertedSoFar: upserted
        });
      }
      upserted += chunk.length;
    }
  } catch (e) {
    return res.status(500).json({ error: 'Upsert loop error: ' + e.message, pagesFetched, upsertedSoFar: upserted });
  }

  return res.status(200).json({ ok: true, pagesFetched, rowsCollected: allRows.length, upserted });
}
