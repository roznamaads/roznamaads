// Universal Paginated Table Downloader — core backend (Batch 2: detect)
// Consolidated into api/admin/router.js as action=table-downloader.
// Does NOT touch any existing feature/action.

import * as cheerio from 'cheerio';
import dns from 'node:dns/promises';
import net from 'node:net';

const USER_AGENT = 'RoznamaAds-TableDownloader/1.0 (+https://roznamaads.com)';
const FETCH_TIMEOUT_MS = 8000; // Vercel Hobby function hard limit ~10s
const MAX_REDIRECTS = 5;
const MAX_RESPONSE_BYTES = 8 * 1024 * 1024; // 8MB safety cap

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
      throw new Error(`Fetch failed: ${e.message}`);
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
      html: text
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
// 5. TABLE EXTRACTION (rowspan/colspan aware) + SCORING
// ---------------------------------------------------------------------------

function tableToGrid($, tableEl) {
  const $table = $(tableEl);
  const rowsEls = $table.find('tr').toArray();
  const grid = [];
  const pending = []; // {col, remainingRows, value}

  rowsEls.forEach((tr, rIdx) => {
    grid[rIdx] = grid[rIdx] || [];
    let col = 0;
    const advancePastPending = () => {
      while (pending[col] && pending[col].remainingRows > 0) {
        grid[rIdx][col] = pending[col].value;
        col++;
      }
    };
    advancePastPending();
    $(tr).find('> td, > th').each((_, cellEl) => {
      advancePastPending();
      const $cell = $(cellEl);
      const colspan = parseInt($cell.attr('colspan') || '1', 10) || 1;
      const rowspan = parseInt($cell.attr('rowspan') || '1', 10) || 1;
      const text = $cell.text().replace(/\s+/g, ' ').trim();
      const isHeader = cellEl.tagName === 'th';
      for (let c = 0; c < colspan; c++) {
        grid[rIdx][col] = { text, isHeader };
        if (rowspan > 1) {
          pending[col] = { remainingRows: rowspan - 1, value: { text, isHeader } };
        }
        col++;
        advancePastPending();
      }
    });
    // decrement pending rowspans for columns not touched this row
    for (let c = 0; c < pending.length; c++) {
      if (pending[c]) pending[c].remainingRows--;
    }
  });

  return grid;
}

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
  const $ = cheerio.load(html);
  const tableEls = $('table').toArray();
  const results = tableEls.map((el, idx) => {
    const grid = tableToGrid($, el);
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

function detectPagination(html, baseUrl) {
  const $ = cheerio.load(html);
  const links = $('a[href]').toArray().map(a => {
    const href = $(a).attr('href');
    const text = $(a).text().replace(/\s+/g, ' ').trim();
    const rel = ($(a).attr('rel') || '').toLowerCase();
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

export async function detectTableAndPagination(inputUrl) {
  let targetUrl;
  try {
    targetUrl = await assertPublicUrl(inputUrl);
  } catch (e) {
    return { ok: false, reason: 'ssrf_blocked', message: e.message };
  }

  const robots = await isAllowedByRobots(targetUrl);
  if (!robots.allowed) {
    return { ok: false, reason: 'robots_disallowed', message: 'robots.txt is site ke is path ko disallow karta hai — downloader isay skip karega.' };
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
    paginationConfidenceNote: pagination ? null : 'Pagination confidently detect nahi ho saki — manual configuration istemal karein.'
  };
}
