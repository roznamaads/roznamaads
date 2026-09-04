// Public Phone Number Risk Checker (RoznamaAds v2 master plan, section 7).
// Uses ONLY RoznamaAds' own public ad-posting data (ads table) as a pattern
// signal, plus any admin-set flag in signals_phone — NEVER telecom
// subscriber/CNIC/SIM-owner data. No auth required (public tool).

function sbHeaders() {
  return {
    apikey: process.env.SUPABASE_SERVICE_KEY,
    Authorization: `Bearer ${process.env.SUPABASE_SERVICE_KEY}`
  };
}
const SB = () => process.env.SUPABASE_URL;

function normalizePkPhone(raw) {
  let d = (raw || '').replace(/\D/g, '');
  if (d.startsWith('0092')) d = d.slice(4);
  else if (d.startsWith('92')) d = d.slice(2);
  if (d.length === 10 && !d.startsWith('0')) d = '0' + d;
  return d;
}

export default async function handler(req, res) {
  const rawPhone = req.method === 'POST' ? (req.body && req.body.phone) : req.query.phone;
  const norm = normalizePkPhone(rawPhone);
  if (norm.length < 10) return res.status(400).json({ error: 'Sahi phone number likhein' });
  const last10 = norm.slice(-10);

  // RoznamaAds' own live ad-posting activity for this number (public data — already visible on ad pages)
  let adsCount = 0, distinctNames = 0, categories = [];
  try {
    const r = await fetch(
      `${SB()}/rest/v1/ads?status=eq.live&contact_phone=ilike.*${last10}*&select=category,submitted_name,title&limit=200`,
      { headers: sbHeaders() }
    );
    const rows = await r.json();
    if (Array.isArray(rows)) {
      adsCount = rows.length;
      const names = new Set(rows.map(a => (a.submitted_name || a.title || '').trim().toLowerCase()).filter(Boolean));
      distinctNames = names.size;
      categories = [...new Set(rows.map(a => a.category).filter(Boolean))];
    }
  } catch (e) { /* best-effort */ }

  // Admin-set flag for this number, if any (never raw subscriber data — RoznamaAds' own internal note)
  let adminFlag = null;
  try {
    const r = await fetch(`${SB()}/rest/v1/signals_phone?normalized_phone=eq.${norm}&select=*&limit=1`, { headers: sbHeaders() });
    const rows = await r.json();
    if (Array.isArray(rows) && rows[0]) adminFlag = rows[0];
  } catch (e) { /* best-effort */ }

  const signals = [];
  if (distinctNames >= 3) signals.push({ severity: 'caution', reason: `Ye number ${distinctNames} mukhtalif naamon ke saath ads mein use hua hai`, source_type: 'roznamaads_internal' });
  if (categories.length >= 3) signals.push({ severity: 'caution', reason: `Ye number ${categories.length} mukhtalif/ghair-mutalliqa categories mein use hua hai (${categories.join(', ')})`, source_type: 'roznamaads_internal' });
  if (adminFlag && adminFlag.signal_status === 'multiple_signals') signals.push({ severity: 'warning', reason: adminFlag.admin_flags || 'Admin ne is number ko flag kiya hai', source_type: 'roznamaads_internal' });
  else if (adminFlag && adminFlag.signal_status === 'watch') signals.push({ severity: 'caution', reason: adminFlag.admin_flags || 'Admin ne is number ko watch list mein rakha hai', source_type: 'roznamaads_internal' });

  const warnings = signals.filter(s => s.severity === 'warning').length;
  const cautions = signals.filter(s => s.severity === 'caution').length;
  let riskStatus = 'insufficient_information';
  if (warnings >= 1) riskStatus = 'official_warning';
  else if ((warnings + cautions) >= 2) riskStatus = 'multiple_risk_signals';
  else if ((warnings + cautions) === 1) riskStatus = 'needs_caution';
  else if (adsCount > 0) riskStatus = 'insufficient_information';

  // Keep signals_phone up to date with live ad-activity counters (admin_flags/signal_status untouched here)
  try {
    const existing = await fetch(`${SB()}/rest/v1/signals_phone?normalized_phone=eq.${norm}&select=id&limit=1`, { headers: sbHeaders() });
    const existingRows = await existing.json();
    const row = { normalized_phone: norm, ads_count: adsCount, distinct_advertiser_names: distinctNames, categories, last_seen: new Date().toISOString(), updated_at: new Date().toISOString() };
    if (Array.isArray(existingRows) && existingRows.length) {
      await fetch(`${SB()}/rest/v1/signals_phone?id=eq.${existingRows[0].id}`, {
        method: 'PATCH', headers: { ...sbHeaders(), 'Content-Type': 'application/json' }, body: JSON.stringify(row)
      });
    } else {
      await fetch(`${SB()}/rest/v1/signals_phone`, {
        method: 'POST', headers: { ...sbHeaders(), 'Content-Type': 'application/json' }, body: JSON.stringify({ ...row, signal_status: 'unflagged' })
      });
    }
  } catch (e) { /* best-effort, never blocks response */ }

  return res.status(200).json({ normalizedPhone: norm, adsCount, distinctNames, categories, signals, riskStatus });
}
