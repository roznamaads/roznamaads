// Universal Paginated Table Downloader — core backend (Batch 2: detect)
// Consolidated into api/admin/router.js as action=table-downloader.
// Does NOT touch any existing feature/action.

import dns from 'node:dns/promises';
import net from 'node:net';
import crypto from 'node:crypto';
import { Agent } from 'undici';
import { extractTableGrids, extractListGrids, extractLinks } from './html-lite-parser.js';

const USER_AGENT = 'RoznamaAds-TableDownloader/1.0 (+https://roznamaads.com)';
const FETCH_TIMEOUT_MS = 25000; // some govt sites (e.g. Punjab eproc.punjab.gov.pk) are very slow; router.js now has maxDuration:60 so this is safe
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
// Direct-connection attempts to a blocked/unreachable host otherwise waste ~10s
// (undici's own default connect timeout) before we even get to try the relay.
// Failing fast here leaves much more of our 60s budget for the relay hop.
const fastFailAgent = new Agent({ connect: { timeout: 5000 } });

// ---------------------------------------------------------------------------
// RELAY (Google Apps Script) — fallback for sites that block datacenter IPs
// (same problem as BEOE, e.g. PPRA-Punjab's eproc.punjab.gov.pk). Google's own
// IP range is generally not blocked by these sites. Free, no proxy cost.
// ---------------------------------------------------------------------------
const RELAY_URL = process.env.RELAY_URL || '';
const RELAY_SECRET = process.env.RELAY_SECRET || '';
const RELAY_TIMEOUT_MS = 48000; // relay hop (us -> Google Apps Script -> slow govt site -> back) needs a lot of slack; router.js has maxDuration:60
const CONNECTION_ERROR_RE = /connect timeout|econnrefused|enotfound|econnreset|ehostunreach|eai_again|network is unreachable|other side closed|fetch failed/i;

function parseSetCookieHeader(rawHeaderValue) {
  if (!rawHeaderValue) return [];
  // Google Apps Script's getAllHeaders() returns an array when a header
  // appears multiple times (e.g. several Set-Cookie headers).
  if (Array.isArray(rawHeaderValue)) {
    return rawHeaderValue.map(c => c.trim().split(';')[0]).filter(Boolean);
  }
  // Otherwise best-effort split of multiple cookies joined by comma.
  return rawHeaderValue.split(/,(?=\s*[^;,]+?=)/).map(c => c.trim().split(';')[0]).filter(Boolean);
}

function extractCookiesFromFetchHeaders(headers) {
  if (typeof headers.getSetCookie === 'function') {
    return headers.getSetCookie().map(c => c.split(';')[0]);
  }
  return parseSetCookieHeader(headers.get ? headers.get('set-cookie') : null);
}

async function relayRequest(urlString, { method = 'GET', headers = {}, body = null, contentType = null } = {}) {
  if (!RELAY_URL || !RELAY_SECRET) {
    throw new Error('Relay configure nahi hai (RELAY_URL / RELAY_SECRET Vercel env vars missing).');
  }
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), RELAY_TIMEOUT_MS);
  let res;
  try {
    res = await fetch(RELAY_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ secret: RELAY_SECRET, url: urlString, method, headers, body, contentType }),
      signal: ctrl.signal
    });
  } catch (e) {
    clearTimeout(timer);
    throw new Error(`Relay tak pohonch nahi hui: ${e.cause?.message || e.message}`);
  }
  clearTimeout(timer);
  if (!res.ok) throw new Error(`Relay ne HTTP ${res.status} return kiya.`);
  let data;
  try {
    data = await res.json();
  } catch {
    throw new Error('Relay se invalid response mila.');
  }
  if (data.error) throw new Error(`Relay error: ${data.error}`);

  const headerEntries = Object.entries(data.headers || {}).map(([k, v]) => [k.toLowerCase(), v]);
  const headerMap = new Map(headerEntries);
  const cookies = parseSetCookieHeader(headerMap.get('set-cookie'));

  return {
    status: data.status,
    headers: headerMap,
    html: data.body || '',
    cookies
  };
}

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
        signal: ctrl.signal,
        dispatcher: fastFailAgent
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
      } else if (RELAY_URL && RELAY_SECRET && (timedOut || CONNECTION_ERROR_RE.test(causeMsg) || CONNECTION_ERROR_RE.test(causeCode || ''))) {
        // Direct connection blocked or hanging — likely datacenter-IP blocking
        // (same pattern as BEOE). Retry via the Google Apps Script relay,
        // which fetches from Google's IP range instead.
        try {
          const relayResult = await relayRequest(currentUrl.toString(), { method: 'GET' });
          return {
            status: relayResult.status,
            headers: relayResult.headers,
            finalUrl: currentUrl.toString(),
            html: relayResult.html,
            insecureTLS: false,
            usedRelay: true,
            cookies: relayResult.cookies
          };
        } catch (relayErr) {
          throw new Error(`Direct connection fail hui (site shayad datacenter IPs block karti hai) aur relay bhi fail: ${relayErr.message}`);
        }
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
      insecureTLS: usedInsecureTLS,
      usedRelay: false,
      cookies: extractCookiesFromFetchHeaders(res.headers)
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

// Combines real <table> grids with generic list/card-detected grids into one
// ordered candidate array. Both detect() and fetch-page() must use this SAME
// function so a given tableIndex always refers to the same source on a page.
function extractAllGrids(html) {
  const tableGrids = extractTableGrids(html).map(grid => ({ grid, sourceType: 'table' }));
  const listGrids = extractListGrids(html).map(grid => ({ grid, sourceType: 'list' }));
  return [...tableGrids, ...listGrids];
}

function computeRankedTables(html) {
  const candidates = extractAllGrids(html);
  const results = candidates.map(({ grid, sourceType }, idx) => {
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
      sourceType,
      rows: dataRows.length,
      cols,
      score,
      nonEmptyPct,
      consistency,
      headers,
      sampleRows,
      dataRows // kept for extraction; stripped before this is sent to the client
    };
  }).filter(t => t.rows > 0 && t.cols > 0);

  results.sort((a, b) => b.score - a.score);
  return results;
}

function extractTables(html) {
  return computeRankedTables(html).map(({ dataRows, ...summary }) => summary);
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

  // 5) ASP.NET WebForms postback pagination (__doPostBack) — common on govt
  // sites built with old ASP.NET grids. No real href, page click runs
  // client-side JS that submits a form (__EVENTTARGET / __EVENTARGUMENT).
  // Two different flavours seen in practice:
  //   a) Telerik RadGrid style — each numbered pager button is its OWN
  //      control with an empty argument (control ID isn't predictable/
  //      computable in advance, must be read off each page's own HTML).
  //   b) Plain ASP.NET GridView style — one shared control, argument is a
  //      predictable "Page$N" — safe to construct for any page number.
  const postbackDynamic = detectPostbackDynamicPagination(html);
  if (postbackDynamic) return postbackDynamic;

  const postback = detectPostbackPagination(html);
  if (postback) return postback;

  return null;
}

function decodeHtmlEntities(str) {
  return String(str)
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&#43;/g, '+')
    .replace(/&#61;/g, '=')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>');
}

// Maps visible pager text (e.g. "2", "3", "Next") -> {control, argument} for
// every __doPostBack anchor on the page. Telerik RadGrid gives each pager
// number its own unique control ID, so the ONLY reliable way to navigate to
// page N is to look up its actual link off the page that's currently showing
// (exactly like a human clicking it) — the ID can't be computed in advance.
function extractPostbackLinkMap(html) {
  // Inner content is captured lazily and tags stripped afterward — Telerik
  // pager numbers are often wrapped in a <span> (or similar), so a naive
  // "no nested tags" capture misses them entirely.
  const re = /<a[^>]*href=["']javascript:__doPostBack\((?:&#39;|')([^'&]+)(?:&#39;|'),\s*(?:&#39;|')([^'&]*)(?:&#39;|')\)["'][^>]*>([\s\S]*?)<\/a>/gi;
  const map = {};
  let m;
  while ((m = re.exec(html))) {
    const control = decodeHtmlEntities(m[1]);
    const argument = decodeHtmlEntities(m[2]);
    const text = decodeHtmlEntities(m[3].replace(/<[^>]+>/g, '')).trim();
    if (text) map[text] = { control, argument };
  }
  return map;
}

// Telerik's numeric pager only shows a WINDOW of page numbers (e.g. "1..10"
// on page 1); once you're deep in the grid the window shifts and the exact
// "current+1" number may not be a link on the current page (e.g. page 10's
// window might only go up to 10, with 11 appearing only after that window
// shifts). Rather than requiring an exact match, jump to whatever the
// SMALLEST available page number greater than the current one is — this is
// exactly what clicking the pager's own "next available" button would do.
function findNextPostbackTarget(linkMap, afterPage) {
  let bestNum = null;
  let bestLink = null;
  for (const [text, link] of Object.entries(linkMap)) {
    const n = parseInt(text, 10);
    if (!Number.isNaN(n) && n > afterPage) {
      if (bestNum === null || n < bestNum) { bestNum = n; bestLink = link; }
    }
  }
  if (bestNum) return { pageNumber: bestNum, control: bestLink.control, argument: bestLink.argument };

  // No literal number found beyond the current pager window (e.g. window
  // shows "1..10", next number isn't a direct link) — fall back to a
  // "..."/next-style control that shifts the window forward. We can't know
  // in advance exactly which page this lands on, so assume afterPage+1 for
  // bookkeeping; if that guess is wrong the next iteration's own re-scan
  // will self-correct since it always reads the REAL current page number
  // fresh off whatever HTML comes back.
  const NEXT_TEXT_RE = /^(\.\.\.|›|»|next|more|agla|▶)$/i;
  for (const [text, link] of Object.entries(linkMap)) {
    if (NEXT_TEXT_RE.test(text.trim())) {
      return { pageNumber: afterPage + 1, control: link.control, argument: link.argument };
    }
  }
  return null;
}

function detectPostbackDynamicPagination(html) {
  const linkMap = extractPostbackLinkMap(html);
  // Require a "2" link to confirm this is really a numbered pager (and that
  // we're not already sitting on the last page of a 1-page result).
  if (!linkMap['2']) return null;

  let estimatedPages = null;
  const summaryMatch = html.match(/(\d+)\s+items?\s+in\s+(\d+)\s+pages?/i);
  if (summaryMatch) {
    estimatedPages = parseInt(summaryMatch[2], 10);
  } else {
    const numericTexts = Object.keys(linkMap).filter(t => /^\d+$/.test(t)).map(Number);
    if (numericTexts.length) estimatedPages = Math.max(...numericTexts);
  }

  return {
    type: 'postback_dynamic',
    estimatedPages,
    confidence: summaryMatch ? 0.85 : 0.5
  };
}

function detectPostbackPagination(html) {
  const re = /__doPostBack\((?:&#39;|')([^'&]+)(?:&#39;|'),\s*(?:&#39;|')Page\$(\d+)(?:&#39;|')\)/g;
  let m;
  let control = null;
  let maxPage = 0;
  while ((m = re.exec(html))) {
    if (!control) control = decodeHtmlEntities(m[1]);
    const pg = parseInt(m[2], 10);
    if (pg > maxPage) maxPage = pg;
  }
  if (!control) return null;

  // Prefer an on-page "X items in Y pages" summary (seen on PPRA-style
  // grids) over the visible page-number window, which is often truncated
  // (e.g. "1 2 3 4 ... 12").
  let estimatedPages = maxPage || null;
  const summaryMatch = html.match(/(\d+)\s+items?\s+in\s+(\d+)\s+pages?/i);
  if (summaryMatch) estimatedPages = parseInt(summaryMatch[2], 10);

  return {
    type: 'postback',
    control,
    estimatedPages,
    confidence: summaryMatch ? 0.9 : 0.55
  };
}

function extractHiddenFields(html) {
  const fields = {};
  const re = /<input\b[^>]*type=["']hidden["'][^>]*>/gi;
  let m;
  while ((m = re.exec(html))) {
    const tag = m[0];
    const nameMatch = tag.match(/\bname=["']([^"']+)["']/i);
    if (!nameMatch) continue;
    const valueMatch = tag.match(/\bvalue=["']([^"']*)["']/i);
    fields[decodeHtmlEntities(nameMatch[1])] = valueMatch ? decodeHtmlEntities(valueMatch[1]) : '';
  }
  return fields;
}

function buildPostbackFormBody(hiddenFields, control, argument) {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(hiddenFields)) {
    params.set(key, value);
  }
  params.set('__EVENTTARGET', control);
  params.set('__EVENTARGUMENT', argument);
  return params.toString();
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
    return { ok: false, reason: 'no_table', message: 'No HTML table ya list detect nahi hui. Website JS-rendered ho sakti hai — public API/XHR endpoint chahiye ho sakta hai.' };
  }

  const pagination = detectPagination(fetched.html, fetched.finalUrl);

  return {
    ok: true,
    website: targetUrl.hostname,
    finalUrl: fetched.finalUrl,
    sourceType: tables[0].sourceType === 'list' ? 'html_list' : 'html_table',
    tables: tables.map((t, i) => ({ ...t, recommended: i === 0 })),
    recommendedIndex: 0,
    pagination: pagination || null,
    paginationConfidenceNote: pagination ? null : 'Pagination confidently detect nahi ho saki — manual configuration istemal karein.',
    insecureTLS: !!fetched.insecureTLS,
    usedRelay: !!fetched.usedRelay,
    robotsOverridden
  };
}

// ---------------------------------------------------------------------------
// 7B. PUBLIC ENTRY: detect/extract from admin-supplied HTML
//
// Used by the "Browser Relay" mode: the admin's own phone browser fetches the
// page (directly via the Google Apps Script relay, no Vercel time limit
// involved) and sends the already-fetched HTML here for the exact same
// table/pagination detection logic as the direct-fetch path. Also usable for
// manually pasted HTML on sites that even the relay can't reach.
// ---------------------------------------------------------------------------

function safeHostnameFromLabel(label) {
  try { return new URL(label).hostname; } catch { return null; }
}

export function detectTableFromHtml(html, sourceLabel) {
  if (!html || typeof html !== 'string' || !html.trim()) {
    return { ok: false, reason: 'empty_html', message: 'Koi HTML content nahi mila.' };
  }
  const tables = extractTables(html);
  if (tables.length === 0) {
    return { ok: false, reason: 'no_table', message: 'HTML mein koi table/list detect nahi hui.' };
  }
  let pagination = null;
  if (sourceLabel) {
    try { pagination = detectPagination(html, sourceLabel); } catch { pagination = null; }
  }
  return {
    ok: true,
    website: sourceLabel ? (safeHostnameFromLabel(sourceLabel) || 'browser-relay') : 'browser-relay',
    finalUrl: sourceLabel || null,
    sourceType: tables[0].sourceType === 'list' ? 'html_list' : 'html_table',
    tables: tables.map((t, i) => ({ ...t, recommended: i === 0 })),
    recommendedIndex: 0,
    pagination: pagination || null,
    paginationConfidenceNote: pagination ? null : 'Pagination detect nahi ho saki.',
    insecureTLS: false,
    usedRelay: true,
    robotsOverridden: false,
    fromBrowserRelay: true
  };
}

export function extractRowsFromHtml(html, tableIndex, sourceLabel) {
  if (!html || typeof html !== 'string' || !html.trim()) {
    return { ok: false, reason: 'empty_html', message: 'Koi HTML content nahi mila.' };
  }
  const idx = Number.isInteger(tableIndex) ? tableIndex : 0;
  const { headers, rows, linkCells, tableFound, junkRowsSkipped } = extractSpecificTableRows(html, idx);
  const contentHash = crypto.createHash('sha1').update(JSON.stringify(rows)).digest('hex').slice(0, 16);
  let pagination = null;
  if (sourceLabel) {
    try { pagination = detectPagination(html, sourceLabel); } catch { pagination = null; }
  }
  return {
    ok: true,
    headers,
    rows,
    linkCells,
    rowCount: rows.length,
    isEmpty: rows.length === 0,
    tableFound,
    contentHash,
    junkRowsSkipped,
    pagination,
    fromBrowserRelay: true
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
  // Must use the exact same filtered+sorted order as extractTables()
  // (used by Detect), or "Table N" in the download step can silently be a
  // different table than "Table N" shown during detect (e.g. a nav-menu
  // <table> that Detect's scoring filtered out, but which sat earlier in the
  // page's raw, unranked table order).
  const ranked = computeRankedTables(html);
  const picked = ranked[tableIndex] || ranked[0];
  const headers = picked ? picked.headers : [];
  const dataRows = picked ? picked.dataRows : [];

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

  return { headers, rows, linkCells, tableFound: ranked.length > 0, junkRowsSkipped };
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
    usedRelay: !!fetched.usedRelay,
    junkRowsSkipped
  };
}

// Fetches ONE page of an ASP.NET __doPostBack-paginated grid (e.g. PPRA
// provincial blacklist sites). Stateful: page 1 is a plain GET; every
// subsequent page needs the hidden form fields (__VIEWSTATE etc.) AND
// cookies from the previous response — the frontend carries `postbackState`
// forward between calls (same "frontend drives the loop" pattern as other
// pagination types), and checkpoints it like it does cursorUrl for next_link.
export async function fetchPostbackPage(inputUrl, tableIndex, control, pageNumber, priorState, paginationType) {
  let targetUrl;
  try {
    targetUrl = await assertPublicUrl(inputUrl);
  } catch (e) {
    return { ok: false, reason: 'ssrf_blocked', message: e.message };
  }

  let actualPageNumber = pageNumber;
  let fetched;
  try {
    if (pageNumber <= 1 || !priorState) {
      fetched = await safeFetchWithRetry(targetUrl.toString());
    } else {
      let targetControl = control;
      let targetArgument = `Page$${pageNumber}`;
      if (paginationType === 'postback_dynamic') {
        // Telerik RadGrid style: each page number is its own control, only
        // discoverable by reading the PRIOR page's own rendered pager links.
        // The pager window may not contain the exact next number (it only
        // shows a window) — jump to whatever the smallest available number
        // greater than the last page fetched is.
        const lastPage = (priorState.lastPageNumber != null) ? priorState.lastPageNumber : (pageNumber - 1);
        const target = findNextPostbackTarget(priorState.linkMap || {}, lastPage);
        if (!target) {
          return { ok: false, reason: 'no_next_link', message: `Page ${lastPage} ke baad koi aur page link nahi mila — shayad ye aakhri page hai.` };
        }
        targetControl = target.control;
        targetArgument = target.argument;
        actualPageNumber = target.pageNumber;
      }
      const body = buildPostbackFormBody(priorState.hiddenFields || {}, targetControl, targetArgument);
      const cookieHeader = (priorState.cookies || []).join('; ');
      if (RELAY_URL && RELAY_SECRET) {
        // Postback almost always happens on sites we already had to relay
        // for (that's how we got here), so POST via relay directly.
        const relayResult = await relayRequest(targetUrl.toString(), {
          method: 'POST',
          body,
          contentType: 'application/x-www-form-urlencoded',
          headers: cookieHeader ? { Cookie: cookieHeader } : {}
        });
        fetched = {
          status: relayResult.status,
          headers: relayResult.headers,
          finalUrl: targetUrl.toString(),
          html: relayResult.html,
          insecureTLS: false,
          usedRelay: true,
          cookies: relayResult.cookies.length ? relayResult.cookies : (priorState.cookies || [])
        };
      } else {
        // No relay configured — try a direct POST (works for postback grids
        // that aren't IP-blocked).
        const ctrl = new AbortController();
        const timer = setTimeout(() => ctrl.abort(), FETCH_TIMEOUT_MS);
        const res = await fetch(targetUrl.toString(), {
          method: 'POST',
          headers: {
            'User-Agent': USER_AGENT,
            'Content-Type': 'application/x-www-form-urlencoded',
            ...(cookieHeader ? { Cookie: cookieHeader } : {})
          },
          body,
          signal: ctrl.signal
        });
        clearTimeout(timer);
        const html = await res.text();
        fetched = {
          status: res.status,
          headers: res.headers,
          finalUrl: targetUrl.toString(),
          html,
          insecureTLS: false,
          usedRelay: false,
          cookies: extractCookiesFromFetchHeaders(res.headers)
        };
      }
    }
  } catch (e) {
    return { ok: false, reason: 'fetch_error', message: e.message };
  }

  const challenge = detectBlockingChallenge(fetched.status, fetched.headers, fetched.html);
  if (challenge.blocked) {
    return { ok: false, reason: `blocked_${challenge.reason}`, message: 'Site ne block/challenge return kiya.', httpStatus: fetched.status };
  }
  if (fetched.status >= 400) {
    return { ok: false, reason: 'http_error', message: `Website returned HTTP ${fetched.status}.`, httpStatus: fetched.status };
  }

  const { headers, rows, linkCells, tableFound, junkRowsSkipped } = extractSpecificTableRows(fetched.html, tableIndex);
  const contentHash = crypto.createHash('sha1').update(JSON.stringify(rows)).digest('hex').slice(0, 16);

  // Merge cookies: keep any prior cookie whose name isn't overwritten by a new one.
  const newCookies = fetched.cookies || [];
  const priorCookies = (priorState && priorState.cookies) || [];
  const newNames = new Set(newCookies.map(c => c.split('=')[0]));
  const mergedCookies = [...priorCookies.filter(c => !newNames.has(c.split('=')[0])), ...newCookies];

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
    finalUrl: fetched.finalUrl,
    usedRelay: !!fetched.usedRelay,
    junkRowsSkipped,
    actualPageNumber,
    // carried forward by the frontend for the NEXT page's postback request
    postbackState: {
      hiddenFields: extractHiddenFields(fetched.html),
      cookies: mergedCookies,
      linkMap: extractPostbackLinkMap(fetched.html),
      lastPageNumber: actualPageNumber
    }
  };
}

// ===========================================================================
// Batch C — Scheduled Auto-Update support. Everything below runs entirely
// server-side (used by the cron endpoint) since there's no browser present
// to drive a page-by-page loop the way the interactive UI does.
// ===========================================================================

function buildPageUrlServer(pagination, pageNumber) {
  if (pagination.type === 'query_parameter') {
    const value = pagination.start + (pageNumber - 1) * pagination.increment;
    return pagination.urlTemplate.replace('{page}', value);
  }
  if (pagination.type === 'path') {
    const value = pagination.start + (pageNumber - 1) * pagination.increment;
    return pagination.template.replace('{page}', value);
  }
  return null; // next_link handled via cursor
}

// Runs a full multi-page fetch for one source, in-process (no HTTP self-calls).
// Mirrors the interactive runDownload() loop in personal-toolkit.html — same
// stop conditions — but bounded by maxPages to fit a single serverless
// invocation's runtime. Returns PARTIAL (not COMPLETED) if maxPages is hit
// before real end-of-pagination, so callers can be honest about coverage.
export async function runFullPaginatedJob(url, maxPages, delayMs) {
  const detected = await detectTableAndPagination(url, false);
  if (!detected.ok) {
    return { ok: false, reason: detected.reason, message: detected.message };
  }

  const tableIndex = 0; // always the top-recommended candidate on a fresh run
  const headers = detected.tables[tableIndex].headers;
  const pagination = detected.pagination;

  const rows = [];
  let pagesFetched = 0, pagesFailed = 0, consecutiveEmpty = 0, lastHash = null;
  let cursorUrl = pagination && pagination.type === 'next_link' ? url : null;
  let stopReason = 'MAX_PAGES_REACHED';

  for (let pageNum = 1; pageNum <= maxPages; pageNum++) {
    if (!pagination && pageNum > 1) { stopReason = 'END_OF_PAGINATION'; break; }

    let targetUrl;
    if (!pagination) {
      targetUrl = url;
    } else if (pagination.type === 'next_link') {
      targetUrl = cursorUrl;
      if (!targetUrl) { stopReason = 'END_OF_PAGINATION'; break; }
    } else {
      targetUrl = buildPageUrlServer(pagination, pageNum);
    }

    let result;
    try {
      result = await fetchSinglePage(targetUrl, tableIndex, pagination ? pagination.type : null);
    } catch (e) {
      pagesFailed++;
      if (pagesFailed >= 5) { stopReason = 'TOO_MANY_ERRORS'; break; }
      await sleep(delayMs);
      continue;
    }

    if (!result.ok) {
      if (result.reason && result.reason.startsWith('blocked_')) { stopReason = result.reason.toUpperCase(); break; }
      pagesFailed++;
      if (pagesFailed >= 5) { stopReason = 'TOO_MANY_ERRORS'; break; }
      await sleep(delayMs);
      continue;
    }

    if (result.endOfPagination) { stopReason = 'END_OF_PAGINATION'; break; }

    if (result.isEmpty) {
      consecutiveEmpty++;
      if (consecutiveEmpty >= 2) { stopReason = 'END_OF_PAGINATION'; break; }
    } else {
      consecutiveEmpty = 0;
    }

    if (result.contentHash && result.contentHash === lastHash) { stopReason = 'REPEATED_CONTENT'; break; }
    lastHash = result.contentHash;

    result.rows.forEach(r => rows.push({ cells: r, sourceUrl: targetUrl }));
    if (pagination && pagination.type === 'next_link') cursorUrl = result.nextUrl;

    pagesFetched++;
    if (!pagination) { stopReason = 'SINGLE_PAGE_COMPLETE'; break; }
    if (pagination.type === 'next_link' && !cursorUrl) { stopReason = 'END_OF_PAGINATION'; break; }

    await sleep(delayMs);
  }

  const partial = stopReason === 'MAX_PAGES_REACHED' || stopReason === 'TOO_MANY_ERRORS';
  return { ok: true, headers, rows, pagesFetched, pagesFailed, stopReason, partial };
}

// Same dedupe logic as the frontend's computeDedupe() — kept independent
// (not imported) since one runs in the browser and one in a serverless fn.
const SERVER_DEDUPE_KEY_PATTERNS = [
  { label: 'ID', re: /^\s*id\s*$|^\s*id\s*(no\.?|number|#)\s*$/i },
  { label: 'Licence No', re: /licen[cs]e\s*(no\.?|number|#)?\s*$/i },
  { label: 'Registration No', re: /registration\s*(no\.?|number|#)?\s*$/i },
  { label: 'Reference No', re: /reference\s*(no\.?|number|#)?\s*$/i },
  { label: 'Application No', re: /application\s*(no\.?|number|#)?\s*$/i },
  { label: 'URL column', re: /url\s*$/i }
];
function normalizeForCompareServer(v) {
  return String(v ?? '').replace(/\s+/g, ' ').trim().toLowerCase();
}
export function computeDedupeServer(rows, headers) {
  let keyIndex = -1;
  for (const pat of SERVER_DEDUPE_KEY_PATTERNS) {
    const idx = headers.findIndex(h => pat.re.test(h));
    if (idx !== -1) { keyIndex = idx; break; }
  }
  const seen = new Set();
  const uniqueRows = [];
  let dupCount = 0;
  for (const row of rows) {
    const key = keyIndex !== -1
      ? normalizeForCompareServer(row.cells[keyIndex])
      : normalizeForCompareServer(row.cells.join('|'));
    if (key && seen.has(key)) { dupCount++; continue; }
    if (key) seen.add(key);
    uniqueRows.push(row);
  }
  return { uniqueRows, dupCount };
}

// Header-NAME based mapping (not index) — a saved source's mapping was
// captured against header text, so it still works if the site later
// reorders columns. Missing headers just map to null for that field.
export function mapRowsToTarget(headers, rows, mapping, target) {
  const findIdx = (headerName) => {
    if (!headerName) return -1;
    return headers.findIndex(h => (h || '').trim().toLowerCase() === headerName.trim().toLowerCase());
  };
  const cell = (row, idx) => (idx !== -1 && row.cells[idx] ? row.cells[idx] : null);

  if (target === 'tenders') {
    const titleIdx = findIdx(mapping.title_header);
    const noIdx = findIdx(mapping.no_header);
    const orgIdx = findIdx(mapping.org_header);
    const statusIdx = findIdx(mapping.status_header);
    const advIdx = findIdx(mapping.adv_header);
    const closeIdx = findIdx(mapping.close_header);
    return rows
      .filter(r => cell(r, titleIdx))
      .map(r => ({
        title: cell(r, titleIdx),
        tender_no: cell(r, noIdx),
        organization: cell(r, orgIdx),
        authority: mapping.authority || 'PPRA',
        status: cell(r, statusIdx),
        advertised_date: cell(r, advIdx),
        closing_date: cell(r, closeIdx),
        source_url: r.sourceUrl || null,
        published: true
      }));
  }

  // verifications (default)
  const nameIdx = findIdx(mapping.name_header);
  const refIdx = findIdx(mapping.ref_header);
  const cityIdx = findIdx(mapping.city_header);
  const statusIdx = findIdx(mapping.status_header);
  const notesIdx = findIdx(mapping.notes_header);
  return rows
    .filter(r => cell(r, nameIdx))
    .map(r => ({
      type: mapping.type || 'society',
      name: cell(r, nameIdx),
      authority: mapping.authority,
      reference_no: cell(r, refIdx),
      city: cell(r, cityIdx),
      status: cell(r, statusIdx) || mapping.fixed_status || 'unknown',
      notes: cell(r, notesIdx),
      official_source_url: r.sourceUrl || null,
      published: mapping.trusted_gov === true
    }));
}
