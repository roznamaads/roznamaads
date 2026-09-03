// Public URL/Website Risk Checker (RoznamaAds v2 master plan, section 8).
// No auth required (public tool on scam-checker.html) — but has basic SSRF
// guards since it fetches an arbitrary user-supplied URL server-side.
//
// Flow: normalize URL -> basic HTTPS/availability check -> redirect structure
// check -> compare final domain against RoznamaAds' own official verification
// source URLs (informational only) -> store/update url_checks row -> return
// an evidence-based risk_status (never a fraud verdict; domain-age/WHOIS-style
// signals are never used as proof, only as supporting context).

function sbHeaders() {
  return {
    apikey: process.env.SUPABASE_SERVICE_KEY,
    Authorization: `Bearer ${process.env.SUPABASE_SERVICE_KEY}`
  };
}
const SB = () => process.env.SUPABASE_URL;

function normalizeDomain(raw) {
  let s = (raw || '').trim().toLowerCase();
  s = s.replace(/^https?:\/\//, '').replace(/^www\./, '');
  s = s.split('/')[0].split('?')[0].split('#')[0];
  return s;
}

function isBlockedHost(host) {
  const h = host.toLowerCase();
  if (['localhost', '127.0.0.1', '0.0.0.0', '::1'].includes(h)) return true;
  if (/^10\.|^192\.168\.|^172\.(1[6-9]|2\d|3[01])\.|^169\.254\./.test(h)) return true;
  return false;
}

export default async function handler(req, res) {
  const rawUrl = req.method === 'POST' ? (req.body && req.body.url) : req.query.url;
  const domain = normalizeDomain(rawUrl);

  if (!domain || !domain.includes('.') || isBlockedHost(domain)) {
    return res.status(400).json({ error: 'Invalid ya blocked URL' });
  }

  const target = `https://${domain}`;
  let httpsResult = 'failed';
  let redirectResult = 'none';
  let finalDomain = domain;
  let claimedIdentity = null;
  let httpStatus = null;

  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 8000);
    const r = await fetch(target, { redirect: 'follow', signal: controller.signal, headers: { 'User-Agent': 'RoznamaAds-URLChecker/1.0' } });
    clearTimeout(timeout);
    httpStatus = r.status;
    httpsResult = r.ok || (r.status >= 200 && r.status < 400) ? 'ok' : 'reachable_but_error';
    finalDomain = normalizeDomain(r.url);
    redirectResult = finalDomain !== domain ? `redirected_to_${finalDomain}` : 'no_redirect';

    try {
      const html = await r.text();
      const m = html.match(/<title[^>]*>([^<]*)<\/title>/i);
      if (m) claimedIdentity = m[1].trim().slice(0, 200);
    } catch (e) { /* body read optional */ }
  } catch (e) {
    httpsResult = 'unreachable';
  }

  // Informational comparison against RoznamaAds' own published official verification sources —
  // NOT a domain-authority/WHOIS check, just "do we already know an official site for this name".
  let officialMatchSignal = 'unknown';
  try {
    const r = await fetch(
      `${SB()}/rest/v1/verifications?published=eq.true&official_source_url=ilike.*${finalDomain}*&select=id,name&limit=1`,
      { headers: sbHeaders() }
    );
    const rows = await r.json();
    if (Array.isArray(rows) && rows.length) officialMatchSignal = 'match';
  } catch (e) { /* best-effort only */ }

  // Count RoznamaAds' own moderated reports against this domain (never shown as proof, only a count)
  let roznamaadsReports = 0;
  try {
    const r = await fetch(
      `${SB()}/rest/v1/reports_risk?target_type=eq.url&target_reference=ilike.*${finalDomain}*&select=id`,
      { headers: sbHeaders() }
    );
    const rows = await r.json();
    if (Array.isArray(rows)) roznamaadsReports = rows.length;
  } catch (e) { /* best-effort only */ }

  // Rule-based risk_status — evidence-based, never an AI/legal verdict.
  let riskStatus = 'insufficient_information';
  if (httpsResult === 'unreachable') riskStatus = 'needs_caution';
  else if (roznamaadsReports >= 2) riskStatus = 'multiple_risk_signals';
  else if (roznamaadsReports === 1) riskStatus = 'needs_caution';
  else if (redirectResult.startsWith('redirected_to_') && officialMatchSignal !== 'match') riskStatus = 'needs_caution';
  else if (officialMatchSignal === 'match' && httpsResult === 'ok') riskStatus = 'verified';
  else if (httpsResult === 'ok') riskStatus = 'insufficient_information';

  // Store/update history (admin-only table — service role write)
  try {
    const existing = await fetch(`${SB()}/rest/v1/url_checks?url_domain=eq.${encodeURIComponent(domain)}&select=id&limit=1`, { headers: sbHeaders() });
    const existingRows = await existing.json();
    const row = {
      url_domain: domain,
      https_basic_result: httpsResult,
      redirect_structure_result: redirectResult,
      claimed_identity: claimedIdentity,
      official_match_signal: officialMatchSignal,
      roznamaads_reports: roznamaadsReports,
      risk_status: riskStatus,
      last_checked: new Date().toISOString()
    };
    if (Array.isArray(existingRows) && existingRows.length) {
      await fetch(`${SB()}/rest/v1/url_checks?id=eq.${existingRows[0].id}`, {
        method: 'PATCH',
        headers: { ...sbHeaders(), 'Content-Type': 'application/json' },
        body: JSON.stringify(row)
      });
    } else {
      await fetch(`${SB()}/rest/v1/url_checks`, {
        method: 'POST',
        headers: { ...sbHeaders(), 'Content-Type': 'application/json' },
        body: JSON.stringify(row)
      });
    }
  } catch (e) { /* history save is best-effort, never blocks the response */ }

  return res.status(200).json({
    domain, finalDomain, httpStatus,
    httpsResult, redirectResult, claimedIdentity,
    officialMatchSignal, roznamaadsReports, riskStatus
  });
}
