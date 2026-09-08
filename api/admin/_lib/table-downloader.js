// Universal Paginated Table Downloader — core backend (Batch 2: detect)
// Consolidated into api/admin/router.js as action=table-downloader.
// Does NOT touch any existing feature/action.

import dns from 'node:dns/promises';
import net from 'node:net';
import crypto from 'node:crypto';
import { Agent } from 'undici';
import { extractTableGrids, extractLinks } from './html-lite-parser.js';

const USER_AGENT = 'RoznamaAds-TableDownloader/1.0 (+https://roznamaads.com)';
const FETCH_TIMEOUT_MS = 8000; // government/SharePoint sites can be slow; still leaves buffer inside Vercel's ~10s limit
const MAX_REDIRECTS = 5;
const MAX_RESPONSE_BYTES = 8 * 1024 * 1024; // 8MB safety cap
const PAGE_FETCH_MAX_ATTEMPTS = 2; // 1 retry for 429 / 5xx

// Some government sites (e.g. HEC's SharePoint) ship an incomplete certificate
// chain (missing intermediate cert) — browsers tolerate this via OS cert
// stores/caching, Node's fetch does not. When we hit that SPECIFIC error we
// retry once with certificate verification relaxed, and flag the result so
// the admin sees a clear warning (this is the target server's own
// misconfiguration, not something we silently hide).
const TLS_CHAIN_ERROR_CODES = new Set([
  'UNABLE_TO_VERIFY_LEAF_SIGNATURE',
  'UNABLE_TO_GET_ISSUER_CERT',
  'UNABLE_TO_GET_ISSUER_CERT_LOCALLY',
  'CERT_UNTRUSTED',
  'SELF_SIGNED_CERT_IN_CHAIN',
  'DEPTH_ZERO_SELF_SIGNED_CERT'
]);
const insecureAgent = new Agent({ connect: { rejectUnauthorized: false } });

// ---------------------------------------------------------------------------
// 1. SSRF PROTECTION
// ---------------------------------------------------------------------------

function isPrivateIPv4(ip) {
  const p = ip.split('.').map(Number);
  if (p.length !== 4 || p.some(n => Number.isNaN(n))) return true; // malformed -> block
  const [a, b] = p;
  if (a === 10) return true;
  if (a === 127) return true;
  if (a === 0) return true;
  if (a === 169 && b === 254) return true; // link-local
  if (a === 172 && b >= 16 && b <= 31) return true;
  if (a === 192 && b === 168) return true;
  if (a === 100 && b >= 64 && b <= 127) return true; // CGNAT
  if (a >= 224) return true; // multicast/reserved
  return false;
}

function isPrivateIPv6(ip) {
  const norm = ip.toLowerCase();
  if (norm === '::1') return true; // loopback
  if (norm === '::') return true;
  if (norm.startsWith('fe80')) return true; // link-local
  if (norm.startsWith('fc') || norm.startsWith('fd')) return true; // unique local
  if (norm.startsWith('::ffff:')) {
    const v4 = norm.split(':').pop();
    if (net.isIPv4(v4)) return isPrivateIPv4(v4);
  }
  return false;
}

function isPrivateIP(ip) {
  if (net.isIPv4(ip)) return isPrivateIPv4(ip);
  if (net.isIPv6(ip)) return isPrivateIPv6(ip);
  return true; // unknown format -> block
}

const BLOCKED_HOSTNAMES = new Set(['localhost', 'metadata.google.internal']);

class SsrfBlockedError extends Error {}

async function assertPublicUrl(urlString) {
  let u;
  try {
    u = new URL(urlString);
  } catch {
    throw new SsrfBlockedError('Invalid URL.');
  }
  if (u.protocol !== 'http:' && u.protocol !== 'https:') {
    throw new SsrfBlockedError('Only http:// and https:// URLs are allowed.');
  }
  const hostname = u.hostname.toLowerCase();
  if (BLOCKED_HOSTNAMES.has(hostname)) {
    throw new SsrfBlockedError('This hostname is not allowed.');
  }
  if (net.isIP(hostname)) {
    if (isPrivateIP(hostname)) throw new SsrfBlockedError('Private/internal IP addresses are not allowed.');
    return u;
  }
  // Resolve DNS and check every returned address (blocks DNS-rebinding to internal IPs)
  let addresses;
  try {
    addresses = await dns.lookup(hostname, { all: true });
  } catch {
    throw new SsrfBlockedError('Could not resolve hostname.');
  }
  if (addresses.length === 0) throw new SsrfBlockedError('Hostname did not resolve.');
  for (const { address } of addresses) {
    if (isPrivateIP(address)) {
      throw new SsrfBlockedError('Hostname resolves to a private/internal IP address.');
    }
  }
  return u;
}

// ---------------------------------------------------------------------------
// 2. ROBOTS.TXT CHECK
// ---------------------------------------------------------------------------

async function isAllowedByRobots(targetUrl) {
  const origin = `${targetUrl.protocol}//${targetUrl.host}`;
  let robotsText = '';
  try {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), 4000);
    const r = await fetch(`${origin}/robots.txt`, {
      headers: { 'User-Agent': USER_AGENT },
      signal: ctrl.signal
    });
    clearTimeout(t);
    if (r.ok) robotsText = await r.text();
  } catch {
    return { allowed: true, checked: false }; // fail-open if robots.txt unreachable
  }
  if (!robotsText) return { allowed: true, checked: false };

  // Minimal robots.txt parser: applies rules under "User-agent: *"
  const lines = robotsText.split(/\r?\n/).map(l => l.trim());
  let inWildcardBlock = false;
  const disallows = [];
  for (const line of lines) {
    if (!line || line.startsWith('#')) continue;
    const [rawKey, ...rest] = line.split(':');
    const key = rawKey.trim().toLowerCase();
    const value = rest.join(':').trim();
    if (key === 'user-agent') {
      inWildcardBlock = value === '*';
    } else if (key === 'disallow' && inWildcardBlock) {
      if (value) disallows.push(value);
    }
  }
  const path = targetUrl.pathname || '/';
  const blocked = disallows.some(rule => rule !== '' && path.startsWith(rule));
  return { allowed: !blocked, checked: true };
}

// ---------------------------------------------------------------------------
// 3. SAFE FETCH (SSRF-checked, redirect-checked, timeout, size-capped)
// ---------------------------------------------------------------------------

async function safeFetch(urlString) {
  let currentUrl = await assertPublicUrl(urlString);
  let usedInsecureTLS = false;

  for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), FETCH_TIMEOUT_MS);
    let res;
    try {
      res = await fetch(currentUrl.toString(), {
        headers: { 'User-Agent': USER_AGENT, Accept: 'text/html,application/xhtml+xml' },
        redirect: 'manual',
        signal: ctrl.signal
      });
    } catch (e) {
      clearTimeout(timer);
      const timedOut = ctrl.signal.aborted;
      const causeCode = e.cause?.code;
      const causeMsg = e.cause?.message || causeCode || e.message;

      // Retry once with relaxed TLS verification if this is specifically a
      // broken-certificate-chain error (server's own misconfiguration).
      if (!timedOut && TLS_CHAIN_ERROR_CODES.has(causeCode)) {
        const ctrl2 = new AbortController();
        const timer2 = setTimeout(() => ctrl2.abort(), FETCH_TIMEOUT_MS);
        try {
          res = await fetch(currentUrl.toString(), {
            headers: { 'User-Agent': USER_AGENT, Accept: 'text/html,application/xhtml+xml' },
            redirect: 'manual',
            signal: ctrl2.signal,
            dispatcher: insecureAgent
          });
          usedInsecureTLS = true;
        } catch (e2) {
          clearTimeout(timer2);
          throw new Error(`Fetch failed (TLS retry bhi fail): ${e2.cause?.message || e2.message}`);
        }
        clearTimeout(timer2);
      } else {
        throw new Error(timedOut
          ? `Fetch timed out after ${FETCH_TIMEOUT_MS}ms — site slow response de raha hai.`
          : `Fetch failed: ${causeMsg}`);
      }
    }
    clearTimeout(timer);

    if ([301, 302, 303, 307, 308].includes(res.status)) {
      const loc = res.headers.get('location');
      if (!loc) throw new Error('Redirect with no Location header.');
      const nextUrl = new URL(loc, currentUrl);
      currentUrl = await assertPublicUrl(nextUrl.toString()); // re-check every redirect hop
      continue;
    }

    const reader = res.body ? res.body.getReader() : null;
    let received = 0;
    const chunks = [];
    if (reader) {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        received += value.length;
        if (received > MAX_RESPONSE_BYTES) {
          throw new Error('Response too large — aborted for safety.');
        }
        chunks.push(value);
      }
    }
    const buf = Buffer.concat(chunks.map(c => Buffer.from(c)));
    const text = buf.toString('utf-8');

    return {
      status: res.status,
      headers: res.headers,
      finalUrl: currentUrl.toString(),
      html: text,
      insecureTLS: usedInsecureTLS
    };
  }
  throw new Error('Too many redirects.');
}

// ---------------------------------------------------------------------------
// 4. CAPTCHA / CLOUDFLARE DETECTION
// ---------------------------------------------------------------------------

function detectBlockingChallenge(status, headers, html) {
  const server = (headers.get('server') || '').toLowerCase();
  const lower = (html || '').slice(0, 20000).toLowerCase();
  if (status === 403 || status === 401) return { blocked: true, reason: 'auth' };
  if (status === 503 && server.includes('cloudflare')) return { blocked: true, reason: 'cloudflare' };
  if (lower.includes('cf-chl') || lower.includes('checking your browser') || lower.includes('just a moment')) {
    return { blocked: true, reason: 'cloudflare' };
  }
  if (lower.includes('g-recaptcha') || lower.includes('h-captcha') || lower.includes('captcha-container')) {
    return { blocked: true, reason: 'captcha' };
  }
  return { blocked: false, reason: null };
}

// ---------------------------------------------------------------------------
// 5. TABLE EXTRACTION (rowspan/colspan aware, dependency-free) + SCORING
// ---------------------------------------------------------------------------

function scoreTable(grid) {
  const rows = grid.length;
  if (rows === 0) return { score: 0, cols: 0, nonEmptyPct: 0, headerRow: null };
  const cols = Math.max(...grid.map(r => r.length));
  if (cols === 0) return { score: 0, cols: 0, nonEmptyPct: 0, headerRow: null };

  let filled = 0, total = 0;
  let headerLikely = false;
  const colCounts = grid.map(r => r.filter(Boolean).length);
  const consistency = colCounts.filter(c => c === cols).length / rows;

  grid.forEach((row, i) => {
    row.forEach(cell => {
      total++;
      if (cell && cell.text) filled++;
      if (i === 0 && cell && cell.isHeader) headerLikely = true;
    });
  });
  const nonEmptyPct = total ? filled / total : 0;

  let score = (Math.min(rows, 200) * 1.2) + (nonEmptyPct * 40) + (consistency * 30) + (headerLikely ? 10 : 0);
  if (rows < 2 || cols < 2) score = Math.min(score, 15); // near-zero confidence for tiny/layout tables

  return { score: Math.round(score), cols, nonEmptyPct: Math.round(nonEmptyPct * 100), headerRow: headerLikely ? grid[0] : null, consistency: Math.round(consistency * 100) };
}

function dedupeHeaderNames(names) {
  const seen = new Map();
  return names.map(raw => {
    const name = raw && raw.trim() ? raw.trim() : 'Column';
    const count = (seen.get(name) || 0) + 1;
    seen.set(name, count);
    return count === 1 ? name : `${name}_${count}`;
  });
}

function extractTables(html) {
  const grids = extractTableGrids(html);
  const results = grids.map((grid, idx) => {
    const { score, cols, nonEmptyPct, headerRow, consistency } = scoreTable(grid);

    let headers;
    let dataRows = grid;
    if (headerRow) {
      headers = headerRow.map(c => (c ? c.text : ''));
      dataRows = grid.slice(1);
    } else if (grid.length > 0) {
      headers = grid[0].map(c => (c ? c.text : ''));
      dataRows = grid.slice(1);
    } else {
      headers = [];
    }
    headers = dedupeHeaderNames(headers.length ? headers : Array.from({ length: cols }, (_, i) => `Column ${i + 1}`));

    const sampleRows = dataRows.slice(0, 3).map(r => headers.map((_, i) => (r[i] ? r[i].text : '')));

    return {
      index: idx,
      rows: dataRows.length,
      cols,
      score,
      nonEmptyPct,
      consistency,
      headers,
      sampleRows
    };
  }).filter(t => t.rows > 0 && t.cols > 0);

  results.sort((a, b) => b.score - a.score);
  return results;
}

// ---------------------------------------------------------------------------
// 6. PAGINATION DETECTION
// ---------------------------------------------------------------------------

const PAGE_PARAM_NAMES = ['page', 'p', 'pg', 'pagenumber', 'page_no', 'pageno', 'page_num', 'pagenum'];
const OFFSET_PARAM_NAMES = ['offset', 'start'];

export function detectPagination(html, baseUrl) {
  const links = extractLinks(html).map(({ href, text, rel }) => {
    let abs;
    try { abs = new URL(href, baseUrl).toString(); } catch { return null; }
    return { href: abs, text, rel };
  }).filter(Boolean);

  // 1) Query-parameter pagination: find links whose query differs from baseUrl only by a page-like param
  const base = new URL(baseUrl);
  let bestQueryParam = null;
  let maxPageSeen = 1;
  for (const { href } of links) {
    let u;
    try { u = new URL(href); } catch { continue; }
    if (u.hostname !== base.hostname || u.pathname !== base.pathname) continue;
    for (const [key, val] of u.searchParams.entries()) {
      const lowerKey = key.toLowerCase();
      if (PAGE_PARAM_NAMES.includes(lowerKey) && /^\d+$/.test(val)) {
        bestQueryParam = key;
        maxPageSeen = Math.max(maxPageSeen, parseInt(val, 10));
      }
    }
  }
  if (bestQueryParam) {
    return {
      type: 'query_parameter',
      parameter: bestQueryParam,
      start: 1,
      increment: 1,
      estimatedPages: maxPageSeen,
      confidence: 0.95,
      urlTemplate: setQueryParamTemplate(base, bestQueryParam)
    };
  }

  // 2) offset/start-style pagination
  let bestOffsetParam = null;
  let offsetStep = null;
  const offsetValues = [];
  for (const { href } of links) {
    let u;
    try { u = new URL(href); } catch { continue; }
    if (u.hostname !== base.hostname || u.pathname !== base.pathname) continue;
    for (const [key, val] of u.searchParams.entries()) {
      if (OFFSET_PARAM_NAMES.includes(key.toLowerCase()) && /^\d+$/.test(val)) {
        bestOffsetParam = key;
        offsetValues.push(parseInt(val, 10));
      }
    }
  }
  if (bestOffsetParam && offsetValues.length) {
    offsetStep = Math.min(...offsetValues.filter(v => v > 0)) || 50;
    return {
      type: 'query_parameter',
      parameter: bestOffsetParam,
      start: 0,
      increment: offsetStep,
      estimatedPages: null,
      confidence: 0.8,
      urlTemplate: setQueryParamTemplate(base, bestOffsetParam)
    };
  }

  // 3) Path-based pagination: /page/2, /p/2
  const pathPatternRe = /\/(page|p)\/(\d+)(\/|$)/i;
  for (const { href } of links) {
    let u;
    try { u = new URL(href); } catch { continue; }
    if (u.hostname !== base.hostname) continue;
    const m = u.pathname.match(pathPatternRe);
    if (m) {
      const template = u.pathname.replace(pathPatternRe, `/${m[1]}/{page}$3`);
      return {
        type: 'path',
        template: `${base.origin}${template}${u.search || ''}`,
        start: 1,
        increment: 1,
        confidence: 0.9
      };
    }
  }

  // 4) rel="next" or textual Next link (single-hop only — no direct page jump)
  const nextLink = links.find(l => l.rel.includes('next'))
    || links.find(l => /^(next|next page|›|»|>|agla|▶)$/i.test(l.text));
  if (nextLink) {
    return {
      type: 'next_link',
      nextUrl: nextLink.href,
      confidence: 0.7
    };
  }

  return null;
}

function setQueryParamTemplate(baseUrl, param) {
  const u = new URL(baseUrl.toString());
  u.searchParams.set(param, '{page}');
  return decodeURIComponent(u.toString()).replace('%7Bpage%7D', '{page}');
}

// ---------------------------------------------------------------------------
// 7. PUBLIC ENTRY: detect()
// ---------------------------------------------------------------------------

export async function detectTableAndPagination(inputUrl, overrideRobots) {
  let targetUrl;
  try {
    targetUrl = await assertPublicUrl(inputUrl);
  } catch (e) {
    return { ok: false, reason: 'ssrf_blocked', message: e.message };
  }

  let robotsOverridden = false;
  if (!overrideRobots) {
    const robots = await isAllowedByRobots(targetUrl);
    if (!robots.allowed) {
      return { ok: false, reason: 'robots_disallowed', message: 'robots.txt is site ke is path ko disallow karta hai — "Ignore robots.txt" checkbox tick kar ke dobara try karein agar ye public, non-sensitive data hai.' };
    }
  } else {
    robotsOverridden = true;
  }

  let fetched;
  try {
    fetched = await safeFetch(targetUrl.toString());
  } catch (e) {
    return { ok: false, reason: 'fetch_error', message: e.message };
  }

  const challenge = detectBlockingChallenge(fetched.status, fetched.headers, fetched.html);
  if (challenge.blocked) {
    const messages = {
      auth: 'Website ne 401/403 Forbidden return kiya. Downloader access restrictions bypass nahi karega.',
      cloudflare: 'Protected challenge (Cloudflare) detect hua. Automated bypass supported nahi hai.',
      captcha: 'CAPTCHA detect hua ya access protected lagta hai. Automated bypass supported nahi hai.'
    };
    return { ok: false, reason: `blocked_${challenge.reason}`, message: messages[challenge.reason] };
  }

  if (fetched.status >= 400) {
    return { ok: false, reason: 'http_error', message: `Website returned HTTP ${fetched.status}.` };
  }

  const tables = extractTables(fetched.html);
  if (tables.length === 0) {
    return { ok: false, reason: 'no_table', message: 'No HTML table detected. Website JS-rendered ho sakti hai — public API/XHR endpoint chahiye ho sakta hai.' };
  }

  const pagination = detectPagination(fetched.html, fetched.finalUrl);

  return {
    ok: true,
    website: targetUrl.hostname,
    finalUrl: fetched.finalUrl,
    sourceType: 'html_table',
    tables: tables.map((t, i) => ({ ...t, recommended: i === 0 })),
    recommendedIndex: 0,
    pagination: pagination || null,
    paginationConfidenceNote: pagination ? null : 'Pagination confidently detect nahi ho saki — manual configuration istemal karein.',
    insecureTLS: !!fetched.insecureTLS,
    robotsOverridden
  };
}

// ---------------------------------------------------------------------------
// 8. MULTI-PAGE FETCH ENGINE (Batch 3): retry/backoff + per-page extraction
// ---------------------------------------------------------------------------

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function safeFetchWithRetry(urlString) {
  let lastErr;
  for (let attempt = 1; attempt <= PAGE_FETCH_MAX_ATTEMPTS; attempt++) {
    try {
      const fetched = await safeFetch(urlString);
      const retryableStatus = fetched.status === 429 || (fetched.status >= 500 && fetched.status <= 504);
      if (retryableStatus && attempt < PAGE_FETCH_MAX_ATTEMPTS) {
        await sleep(800 * attempt); // exponential-ish backoff
        continue;
      }
      return fetched;
    } catch (e) {
      lastErr = e;
      if (attempt < PAGE_FETCH_MAX_ATTEMPTS) {
        await sleep(500);
        continue;
      }
      throw e;
    }
  }
  throw lastErr || new Error('Fetch retry exhausted.');
}

// Detects two common "junk row" patterns seen on messy government sites
// (e.g. HEC's province-header rows, mid-table repeated column titles):
//  1. Section/group header row — every non-empty cell has the identical text
//     (a merged/rowspan-style heading like "PUNJAB" repeated across columns).
//  2. Header-echo row — the row's cells match the table's own column headers
//     (happens when a page stacks several mini-tables, each with its own
//     header row, inside one bigger table).
// This is a general, conservative heuristic — it only strips rows that are
// CLEARLY not data, it does not attempt any site-specific cleanup.
function isJunkRow(rowCells, headers) {
  const nonEmpty = rowCells.map(c => (c || '').trim()).filter(Boolean);
  if (nonEmpty.length === 0) return true; // fully empty row

  if (nonEmpty.length >= 2 && new Set(nonEmpty.map(c => c.toLowerCase())).size === 1) {
    return true; // section header spanning all columns
  }

  const normalizedRow = rowCells.map(c => (c || '').trim().toLowerCase());
  const normalizedHeaders = headers.map(h => (h || '').trim().toLowerCase());
  let matchCount = 0;
  for (let i = 0; i < normalizedHeaders.length; i++) {
    if (normalizedHeaders[i] && normalizedRow[i] === normalizedHeaders[i]) matchCount++;
  }
  if (normalizedHeaders.length > 0 && matchCount >= Math.max(2, Math.ceil(normalizedHeaders.length * 0.6))) {
    return true; // repeats the table's own header labels
  }

  return false;
}

function extractSpecificTableRows(html, tableIndex) {
  const grids = extractTableGrids(html);
  const grid = grids[tableIndex] || grids[0] || [];
  const headerRowRaw = grid.length > 0 ? grid[0] : null;
  const dataRows = grid.slice(1);
  const headers = headerRowRaw ? headerRowRaw.map(c => (c ? c.text : '')) : [];

  const allRows = dataRows.map(r => headers.map((_, i) => (r[i] ? r[i].text : '')));
  const allLinkCells = dataRows.map(r => headers.map((_, i) => (r[i] ? r[i].linkHref : null)));

  const rows = [];
  const linkCells = [];
  let junkRowsSkipped = 0;
  allRows.forEach((rowCells, idx) => {
    if (isJunkRow(rowCells, headers)) {
      junkRowsSkipped++;
    } else {
      rows.push(rowCells);
      linkCells.push(allLinkCells[idx]);
    }
  });

  return { headers, rows, linkCells, tableFound: grids.length > 0, junkRowsSkipped };
}

// Fetches ONE page, extracts the chosen table's rows, and (for next_link-style
// pagination only) reports the next URL found on that page — the frontend
// drives the loop across many invocations to stay inside Vercel's timeout.
export async function fetchSinglePage(inputUrl, tableIndex, paginationType) {
  let targetUrl;
  try {
    targetUrl = await assertPublicUrl(inputUrl);
  } catch (e) {
    return { ok: false, reason: 'ssrf_blocked', message: e.message };
  }

  let fetched;
  try {
    fetched = await safeFetchWithRetry(targetUrl.toString());
  } catch (e) {
    return { ok: false, reason: 'fetch_error', message: e.message };
  }

  const challenge = detectBlockingChallenge(fetched.status, fetched.headers, fetched.html);
  if (challenge.blocked) {
    const messages = {
      auth: 'Website ne 401/403 Forbidden return kiya — downloader access restrictions bypass nahi karega.',
      cloudflare: 'Cloudflare challenge detect hua — automated bypass supported nahi hai.',
      captcha: 'CAPTCHA detect hua — automated bypass supported nahi hai.'
    };
    return { ok: false, reason: `blocked_${challenge.reason}`, message: messages[challenge.reason], httpStatus: fetched.status };
  }

  if (fetched.status === 404) {
    return { ok: true, httpStatus: 404, headers: [], rows: [], rowCount: 0, isEmpty: true, endOfPagination: true, nextUrl: null };
  }
  if (fetched.status >= 400) {
    return { ok: false, reason: 'http_error', message: `Website returned HTTP ${fetched.status}.`, httpStatus: fetched.status };
  }

  const { headers, rows, linkCells, tableFound, junkRowsSkipped } = extractSpecificTableRows(fetched.html, tableIndex);
  const contentHash = crypto.createHash('sha1').update(JSON.stringify(rows)).digest('hex').slice(0, 16);

  let nextUrl = null;
  if (paginationType === 'next_link') {
    const p = detectPagination(fetched.html, fetched.finalUrl);
    if (p && p.type === 'next_link') nextUrl = p.nextUrl;
  }

  return {
    ok: true,
    httpStatus: fetched.status,
    headers,
    rows,
    linkCells,
    rowCount: rows.length,
    isEmpty: rows.length === 0,
    tableFound,
    contentHash,
    nextUrl,
    finalUrl: fetched.finalUrl,
    insecureTLS: !!fetched.insecureTLS,
    junkRowsSkipped
  };
}
