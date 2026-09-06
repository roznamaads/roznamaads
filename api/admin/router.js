// Consolidated admin API — sab admin actions ek hi serverless function mein
// (Vercel Hobby plan sirf 12 functions allow karta hai, isliye sab merge kiya gaya hai)
// Routes: /api/admin/<action> — vercel.json ke rewrite se yahan aata hai, e.g. /api/admin/list?status=pending

import { beoeData } from './beoe-data.js';
import { detectTableAndPagination, fetchSinglePage } from './_lib/table-downloader.js';

const VALID_CATEGORIES = [
  'property','jobs','vehicles','matrimonial','visa','auctions',
  'admissions','tenders','notices','services','electronics'
];

function sbHeaders(){
  return {
    apikey: process.env.SUPABASE_SERVICE_KEY,
    Authorization: `Bearer ${process.env.SUPABASE_SERVICE_KEY}`
  };
}
const SB = () => process.env.SUPABASE_URL;

export default async function handler(req, res) {
  if (req.headers['x-admin-secret'] !== process.env.ADMIN_API_SECRET) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  const actionParam = req.query.action;
  const action = Array.isArray(actionParam) ? actionParam[0] : actionParam;

  try {
    switch (action) {

      case 'list': {
        const status = req.query.status || 'pending';
        const r = await fetch(
          `${SB()}/rest/v1/ads?status=eq.${encodeURIComponent(status)}&order=created_at.desc&select=*`,
          { headers: sbHeaders() }
        );
        const data = await r.json();
        return res.status(r.status).json(data);
      }

      case 'update-status': {
        if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
        const { id, status } = req.body || {};
        if (!id || !status) return res.status(400).json({ error: 'id and status required' });
        const body = { status };
        if (status === 'live') body.approved_at = new Date().toISOString();
        const r = await fetch(`${SB()}/rest/v1/ads?id=eq.${id}`, {
          method: 'PATCH',
          headers: { ...sbHeaders(), 'Content-Type': 'application/json', Prefer: 'return=representation' },
          body: JSON.stringify(body)
        });
        const data = await r.json();
        return res.status(r.status).json(data);
      }

      case 'update-ad': {
        if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
        const ALLOWED_FIELDS = ['title', 'city', 'description', 'price', 'contact_phone'];
        const { id, fields } = req.body || {};
        if (!id || !fields) return res.status(400).json({ error: 'id and fields required' });
        const patch = {};
        for (const key of ALLOWED_FIELDS) if (fields[key] !== undefined) patch[key] = fields[key];
        if (Object.keys(patch).length === 0) return res.status(400).json({ error: 'No valid fields to update' });
        const r = await fetch(`${SB()}/rest/v1/ads?id=eq.${id}`, {
          method: 'PATCH',
          headers: { ...sbHeaders(), 'Content-Type': 'application/json', Prefer: 'return=representation' },
          body: JSON.stringify(patch)
        });
        const data = await r.json();
        return res.status(r.status).json(data);
      }

      case 'delete-ad': {
        if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
        const { id } = req.body || {};
        if (!id) return res.status(400).json({ error: 'id required' });
        const r = await fetch(`${SB()}/rest/v1/ads?id=eq.${id}`, { method: 'DELETE', headers: sbHeaders() });
        return res.status(r.status).json({ ok: r.ok });
      }

      case 'reports': {
        const r = await fetch(
          `${SB()}/rest/v1/ad_reports?select=*,ads(title,status)&order=reported_at.desc`,
          { headers: sbHeaders() }
        );
        const data = await r.json();
        return res.status(r.status).json(data);
      }

      case 'dismiss-report': {
        if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
        const { id } = req.body || {};
        if (!id) return res.status(400).json({ error: 'id required' });
        const r = await fetch(`${SB()}/rest/v1/ad_reports?id=eq.${id}`, { method: 'DELETE', headers: sbHeaders() });
        return res.status(r.status).json({ ok: r.ok });
      }

      case 'expiry-list': {
        const r = await fetch(
          `${SB()}/rest/v1/ads?status=in.(live,expired)&order=expires_at.asc&select=id,title,city,status,expires_at`,
          { headers: sbHeaders() }
        );
        const data = await r.json();
        return res.status(r.status).json(data);
      }

      case 'extend-expiry': {
        if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
        const { id, days } = req.body || {};
        if (!id) return res.status(400).json({ error: 'id required' });
        const extendDays = Number(days) || 30;
        const getRes = await fetch(`${SB()}/rest/v1/ads?id=eq.${id}&select=expires_at`, { headers: sbHeaders() });
        const rows = await getRes.json();
        if (!rows.length) return res.status(404).json({ error: 'Ad not found' });
        const base = rows[0].expires_at ? new Date(rows[0].expires_at) : new Date();
        const newExpiry = new Date(Math.max(base.getTime(), Date.now()) + extendDays * 24 * 60 * 60 * 1000);
        const patchRes = await fetch(`${SB()}/rest/v1/ads?id=eq.${id}`, {
          method: 'PATCH',
          headers: { ...sbHeaders(), 'Content-Type': 'application/json', Prefer: 'return=representation' },
          body: JSON.stringify({ expires_at: newExpiry.toISOString(), status: 'live' })
        });
        const data = await patchRes.json();
        return res.status(patchRes.status).json(data);
      }

      case 'stats': {
        const r = await fetch(
          `${SB()}/rest/v1/ads?select=id,category,city,status,created_at`,
          { headers: sbHeaders() }
        );
        const ads = await r.json();
        if (!Array.isArray(ads)) return res.status(500).json({ error: 'Unexpected response from database' });
        const byStatus = {}, byCategory = {}, byCity = {};
        let last7 = 0, last30 = 0;
        const now = Date.now();
        for (const ad of ads) {
          byStatus[ad.status] = (byStatus[ad.status] || 0) + 1;
          if (ad.status === 'live') {
            byCategory[ad.category] = (byCategory[ad.category] || 0) + 1;
            byCity[ad.city] = (byCity[ad.city] || 0) + 1;
          }
          const ageDays = (now - new Date(ad.created_at).getTime()) / (1000 * 60 * 60 * 24);
          if (ageDays <= 7) last7++;
          if (ageDays <= 30) last30++;
        }
        const sortDesc = (obj) => Object.entries(obj).sort((a, b) => b[1] - a[1]);
        return res.status(200).json({
          total: ads.length, byStatus,
          byCategory: sortDesc(byCategory),
          byCity: sortDesc(byCity).slice(0, 8),
          last7, last30
        });
      }

      case 'create-draft': {
        if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
        const { category, title, city, price, description, contact_phone, extra_fields, images } = req.body || {};
        if (!category || !VALID_CATEGORIES.includes(category)) return res.status(400).json({ error: 'Valid category required' });
        if (!title || !title.trim()) return res.status(400).json({ error: 'title required' });
        if (!description || !description.trim()) return res.status(400).json({ error: 'description required' });
        const row = {
          category, title: title.trim(), city: (city || '').trim(), price: (price || '').trim(),
          description: description.trim(), contact_phone: (contact_phone || '').trim(),
          images: Array.isArray(images) ? images : [],
          extra_fields: extra_fields && typeof extra_fields === 'object' ? extra_fields : {},
          submitted_name: 'AI Draft (Ad Post Generator)', status: 'pending'
        };
        const r = await fetch(`${SB()}/rest/v1/ads`, {
          method: 'POST',
          headers: { ...sbHeaders(), 'Content-Type': 'application/json', Prefer: 'return=representation' },
          body: JSON.stringify(row)
        });
        const data = await r.json();
        return res.status(r.status).json(data);
      }

      case 'check-duplicate': {
        if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
        const { title, contact_phone, category } = req.body || {};
        if ((!title || !title.trim()) && (!contact_phone || !contact_phone.trim())) {
          return res.status(400).json({ error: 'title ya contact_phone zaroori hai' });
        }
        const base = `${SB()}/rest/v1/ads`;
        const matches = new Map();
        if (contact_phone && contact_phone.trim()) {
          const url = `${base}?contact_phone=eq.${encodeURIComponent(contact_phone.trim())}&status=in.(live,pending)&select=id,title,city,contact_phone,status,created_at,category`;
          const r = await fetch(url, { headers: sbHeaders() });
          const rows = await r.json();
          if (Array.isArray(rows)) rows.forEach(row => matches.set(row.id, { ...row, matchedBy: 'phone' }));
        }
        if (title && title.trim()) {
          const words = title.trim().split(/\s+/).filter(w => w.length > 2).slice(0, 2);
          if (words.length) {
            const pattern = '*' + words.join('*') + '*';
            let url = `${base}?title=ilike.${encodeURIComponent(pattern)}&status=in.(live,pending)&select=id,title,city,contact_phone,status,created_at,category`;
            if (category) url += `&category=eq.${encodeURIComponent(category)}`;
            const r = await fetch(url, { headers: sbHeaders() });
            const rows = await r.json();
            if (Array.isArray(rows)) rows.forEach(row => { if (!matches.has(row.id)) matches.set(row.id, { ...row, matchedBy: 'title' }); });
          }
        }
        return res.status(200).json({ matches: Array.from(matches.values()) });
      }

      case 'export-all': {
        const r = await fetch(`${SB()}/rest/v1/ads?select=*&order=created_at.desc`, { headers: sbHeaders() });
        const data = await r.json();
        return res.status(r.status).json(data);
      }

      case 'restore-import': {
        if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
        const { rows } = req.body || {};
        if (!Array.isArray(rows) || !rows.length) return res.status(400).json({ error: 'rows array required' });
        const r = await fetch(`${SB()}/rest/v1/ads?on_conflict=id`, {
          method: 'POST',
          headers: { ...sbHeaders(), 'Content-Type': 'application/json', Prefer: 'resolution=merge-duplicates,return=representation' },
          body: JSON.stringify(rows)
        });
        const data = await r.json();
        return res.status(r.status).json(data);
      }

      /* ---------- Part A: Society/Visa Verification (verification_sources) ---------- */

      case 'verif-sources-list': {
        const r = await fetch(
          `${SB()}/rest/v1/verification_sources?order=created_at.desc&select=*`,
          { headers: sbHeaders() }
        );
        const data = await r.json();
        return res.status(r.status).json(data);
      }

      case 'verif-source-save': {
        if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
        const { id, name, authority, target_type, official_url, import_method, active, last_checked, next_check, notes } = req.body || {};
        if (!name || !authority || !target_type || !official_url) {
          return res.status(400).json({ error: 'name, authority, target_type, official_url zaroori hain' });
        }
        const row = {
          name, authority, target_type, official_url,
          import_method: import_method || 'manual',
          active: active !== false,
          last_checked: last_checked || null,
          next_check: next_check || null,
          notes: notes || null
        };
        let r;
        if (id) {
          r = await fetch(`${SB()}/rest/v1/verification_sources?id=eq.${id}`, {
            method: 'PATCH',
            headers: { ...sbHeaders(), 'Content-Type': 'application/json', Prefer: 'return=representation' },
            body: JSON.stringify(row)
          });
        } else {
          r = await fetch(`${SB()}/rest/v1/verification_sources`, {
            method: 'POST',
            headers: { ...sbHeaders(), 'Content-Type': 'application/json', Prefer: 'return=representation' },
            body: JSON.stringify(row)
          });
        }
        const data = await r.json();
        return res.status(r.status).json(data);
      }

      case 'verif-source-delete': {
        if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
        const { id } = req.body || {};
        if (!id) return res.status(400).json({ error: 'id required' });
        const r = await fetch(`${SB()}/rest/v1/verification_sources?id=eq.${id}`, { method: 'DELETE', headers: sbHeaders() });
        return res.status(r.status).json({ ok: r.ok });
      }

      /* ---------- Part A: verifications records (Import/Review) ---------- */

      case 'verif-list': {
        const type = req.query.type;
        const search = req.query.search;
        const limit = Math.min(parseInt(req.query.limit || '50', 10) || 50, 200);
        let url = `${SB()}/rest/v1/verifications?order=updated_at.desc&select=*&limit=${limit}`;
        if (type) url += `&type=eq.${encodeURIComponent(type)}`;
        if (search) url += `&or=(name.ilike.*${encodeURIComponent(search)}*,reference_no.ilike.*${encodeURIComponent(search)}*)`;
        const r = await fetch(url, { headers: sbHeaders() });
        const data = await r.json();
        return res.status(r.status).json(data);
      }

      case 'verif-save': {
        if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
        const { id, type, name, aliases, city, authority, reference_no, status, blacklist_status, last_verified, official_source_url, notes, published } = req.body || {};
        if (!type || !name || !authority || !status) {
          return res.status(400).json({ error: 'type, name, authority, status zaroori hain' });
        }
        const row = {
          type, name,
          aliases: Array.isArray(aliases) ? aliases : [],
          city: city || null,
          authority, reference_no: reference_no || null, status,
          blacklist_status: blacklist_status || null,
          last_verified: last_verified || null,
          official_source_url: official_source_url || null,
          notes: notes || null,
          published: published === true,
          updated_at: new Date().toISOString()
        };
        let r;
        if (id) {
          // Snapshot old row into verification_history before applying the update (audit trail)
          try {
            const oldR = await fetch(`${SB()}/rest/v1/verifications?id=eq.${id}&select=*`, { headers: sbHeaders() });
            const oldRows = await oldR.json();
            if (Array.isArray(oldRows) && oldRows[0]) {
              await fetch(`${SB()}/rest/v1/verification_history`, {
                method: 'POST',
                headers: { ...sbHeaders(), 'Content-Type': 'application/json' },
                body: JSON.stringify({ verification_id: id, old_data: oldRows[0], new_data: row })
              });
            }
          } catch (e) { /* history logging is best-effort, never blocks the save */ }

          r = await fetch(`${SB()}/rest/v1/verifications?id=eq.${id}`, {
            method: 'PATCH',
            headers: { ...sbHeaders(), 'Content-Type': 'application/json', Prefer: 'return=representation' },
            body: JSON.stringify(row)
          });
        } else {
          r = await fetch(`${SB()}/rest/v1/verifications`, {
            method: 'POST',
            headers: { ...sbHeaders(), 'Content-Type': 'application/json', Prefer: 'return=representation' },
            body: JSON.stringify(row)
          });
        }
        const data = await r.json();
        return res.status(r.status).json(data);
      }

      case 'verif-history-list': {
        const verification_id = req.query.verification_id;
        if (!verification_id) return res.status(400).json({ error: 'verification_id required' });
        const r = await fetch(
          `${SB()}/rest/v1/verification_history?verification_id=eq.${verification_id}&order=changed_at.desc&select=*`,
          { headers: sbHeaders() }
        );
        const data = await r.json();
        return res.status(r.status).json(data);
      }

      case 'verif-publish': {
        if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
        const { id, published } = req.body || {};
        if (!id) return res.status(400).json({ error: 'id required' });
        const r = await fetch(`${SB()}/rest/v1/verifications?id=eq.${id}`, {
          method: 'PATCH',
          headers: { ...sbHeaders(), 'Content-Type': 'application/json', Prefer: 'return=representation' },
          body: JSON.stringify({ published: published === true, updated_at: new Date().toISOString() })
        });
        const data = await r.json();
        return res.status(r.status).json(data);
      }

      case 'verif-delete': {
        if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
        const { id } = req.body || {};
        if (!id) return res.status(400).json({ error: 'id required' });
        const r = await fetch(`${SB()}/rest/v1/verifications?id=eq.${id}`, { method: 'DELETE', headers: sbHeaders() });
        return res.status(r.status).json({ ok: r.ok });
      }

      /* ---------- Part B: Risk Signals ---------- */

      case 'risk-signals-list': {
        const status = req.query.status;
        const target_type = req.query.target_type;
        let url = `${SB()}/rest/v1/risk_signals?order=created_at.desc&select=*`;
        if (status) url += `&status=eq.${encodeURIComponent(status)}`;
        if (target_type) url += `&target_type=eq.${encodeURIComponent(target_type)}`;
        const r = await fetch(url, { headers: sbHeaders() });
        const data = await r.json();
        return res.status(r.status).json(data);
      }

      case 'risk-signal-save': {
        if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
        const { id, target_type, target_reference, verification_id, signal_type, severity, reason, source_type, source_url, status, reviewed_by } = req.body || {};
        if (!target_type || !target_reference || !signal_type || !source_type) {
          return res.status(400).json({ error: 'target_type, target_reference, signal_type, source_type zaroori hain' });
        }
        const row = {
          target_type, target_reference,
          verification_id: verification_id || null,
          signal_type, severity: severity || 'caution', reason: reason || null,
          source_type, source_url: source_url || null,
          status: status || 'pending',
          reviewed_by: reviewed_by || null
        };
        let r;
        if (id) {
          r = await fetch(`${SB()}/rest/v1/risk_signals?id=eq.${id}`, {
            method: 'PATCH',
            headers: { ...sbHeaders(), 'Content-Type': 'application/json', Prefer: 'return=representation' },
            body: JSON.stringify(row)
          });
        } else {
          r = await fetch(`${SB()}/rest/v1/risk_signals`, {
            method: 'POST',
            headers: { ...sbHeaders(), 'Content-Type': 'application/json', Prefer: 'return=representation' },
            body: JSON.stringify(row)
          });
        }
        const data = await r.json();
        return res.status(r.status).json(data);
      }

      case 'risk-signal-delete': {
        if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
        const { id } = req.body || {};
        if (!id) return res.status(400).json({ error: 'id required' });
        const r = await fetch(`${SB()}/rest/v1/risk_signals?id=eq.${id}`, { method: 'DELETE', headers: sbHeaders() });
        return res.status(r.status).json({ ok: r.ok });
      }

      /* ---------- Part B: Risk Reports Queue (reports_risk) ---------- */

      case 'reports-risk-list': {
        const status = req.query.status;
        let url = `${SB()}/rest/v1/reports_risk?order=created_at.desc&select=*`;
        if (status) url += `&status=eq.${encodeURIComponent(status)}`;
        const r = await fetch(url, { headers: sbHeaders() });
        const data = await r.json();
        return res.status(r.status).json(data);
      }

      case 'reports-risk-update': {
        if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
        const { id, status, admin_action } = req.body || {};
        if (!id || !status) return res.status(400).json({ error: 'id, status zaroori hain' });
        const r = await fetch(`${SB()}/rest/v1/reports_risk?id=eq.${id}`, {
          method: 'PATCH',
          headers: { ...sbHeaders(), 'Content-Type': 'application/json', Prefer: 'return=representation' },
          body: JSON.stringify({ status, admin_action: admin_action || null, reviewed_at: new Date().toISOString() })
        });
        const data = await r.json();
        return res.status(r.status).json(data);
      }

      /* ---------- Dashboard stats ---------- */
      case 'dashboard-stats': {
        const countHeaders = { ...sbHeaders(), Prefer: 'count=exact' };
        const getCount = async (path) => {
          const r = await fetch(`${SB()}/rest/v1/${path}`, { method: 'HEAD', headers: countHeaders });
          const cr = r.headers.get('content-range'); // e.g. "*/42"
          return cr ? parseInt(cr.split('/')[1] || '0', 10) : 0;
        };
        const [verifTotal, verifPublished, sigActive, sigPending, repNew, repUnderReview, urlChecksTotal, phoneFlagged] = await Promise.all([
          getCount('verifications?select=id'),
          getCount('verifications?select=id&published=eq.true'),
          getCount('risk_signals?select=id&status=eq.active'),
          getCount('risk_signals?select=id&status=eq.pending'),
          getCount('reports_risk?select=id&status=eq.new'),
          getCount('reports_risk?select=id&status=eq.under_review'),
          getCount('url_checks?select=id'),
          getCount('signals_phone?select=id&signal_status=neq.unflagged')
        ]);
        return res.status(200).json({
          verifTotal, verifPublished, sigActive, sigPending,
          repNew, repUnderReview, urlChecksTotal, phoneFlagged
        });
      }

      /* ---------- Phone signals (admin flags — public phone checker reads via api/phone-check) ---------- */
      case 'phone-signals-list': {
        const r = await fetch(`${SB()}/rest/v1/signals_phone?order=updated_at.desc&select=*`, { headers: sbHeaders() });
        const data = await r.json();
        return res.status(r.status).json(data);
      }

      case 'phone-signal-save': {
        if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
        const { id, normalized_phone, admin_flags, signal_status } = req.body || {};
        if (!normalized_phone) return res.status(400).json({ error: 'normalized_phone required' });
        const row = { normalized_phone, admin_flags: admin_flags || null, signal_status: signal_status || 'unflagged', updated_at: new Date().toISOString() };
        let r;
        if (id) {
          r = await fetch(`${SB()}/rest/v1/signals_phone?id=eq.${id}`, {
            method: 'PATCH',
            headers: { ...sbHeaders(), 'Content-Type': 'application/json', Prefer: 'return=representation' },
            body: JSON.stringify(row)
          });
        } else {
          r = await fetch(`${SB()}/rest/v1/signals_phone?on_conflict=normalized_phone`, {
            method: 'POST',
            headers: { ...sbHeaders(), 'Content-Type': 'application/json', Prefer: 'resolution=merge-duplicates,return=representation' },
            body: JSON.stringify(row)
          });
        }
        const data = await r.json();
        return res.status(r.status).json(data);
      }

      case 'phone-signal-delete': {
        if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
        const { id } = req.body || {};
        if (!id) return res.status(400).json({ error: 'id required' });
        const r = await fetch(`${SB()}/rest/v1/signals_phone?id=eq.${id}`, { method: 'DELETE', headers: sbHeaders() });
        return res.status(r.status).json({ ok: r.ok });
      }

      /* ---------- URL checks (read-only history — written by public api/url-check) ---------- */
      case 'url-checks-list': {
        const r = await fetch(`${SB()}/rest/v1/url_checks?order=last_checked.desc&select=*&limit=100`, { headers: sbHeaders() });
        const data = await r.json();
        return res.status(r.status).json(data);
      }

      /* ---------- BEOE bulk import (one-time base load + periodic refresh) ---------- */
      // Call repeatedly with increasing ?offset=0,500,1000... until done:true.
      // Requires the unique index from sql/beoe-import-schema.sql to be run first.
      case 'beoe-import': {
        const offset = parseInt(req.query.offset || '0', 10);
        const limit = parseInt(req.query.limit || '500', 10);
        const batch = beoeData.slice(offset, offset + limit);

        if (batch.length === 0) {
          return res.status(200).json({ done: true, total: beoeData.length, offset });
        }

        const nowIso = new Date().toISOString();
        const rows = batch.map(r => {
          // best-effort city guess: second-to-last comma-separated token of the address
          const parts = (r.head_office_raw || '').split(',').map(s => s.trim()).filter(Boolean);
          const city = parts.length >= 2 ? parts[parts.length - 2] : null;

          const noteBits = [];
          if (r.proprietor) noteBits.push(`Proprietor: ${r.proprietor}`);
          if (r.permissions) noteBits.push(`Permissions: ${r.permissions}`);
          if (r.expiry_date) noteBits.push(`Expiry: ${r.expiry_date}`);
          if (r.head_office_raw) noteBits.push(`Office: ${r.head_office_raw}`);
          if (r.branch_office_raw) noteBits.push(`Branch: ${r.branch_office_raw}`);

          return {
            type: 'visa_agency',
            name: r.agency_name || r.license_no,
            city,
            authority: 'BEOE',
            reference_no: r.license_no,
            status: (r.status || 'unknown').toLowerCase(),
            blacklist_status: null,
            last_verified: nowIso,
            official_source_url: 'https://beoe.gov.pk/list-of-oeps',
            notes: noteBits.join(' | '),
            published: false
          };
        });

        const r = await fetch(`${SB()}/rest/v1/verifications?on_conflict=authority,reference_no`, {
          method: 'POST',
          headers: {
            ...sbHeaders(),
            'Content-Type': 'application/json',
            Prefer: 'resolution=merge-duplicates,return=minimal'
          },
          body: JSON.stringify(rows)
        });

        if (!r.ok) {
          const errText = await r.text();
          return res.status(r.status).json({ error: errText, offset });
        }

        const nextOffset = offset + batch.length;
        return res.status(200).json({
          done: nextOffset >= beoeData.length,
          inserted: batch.length,
          offset: nextOffset,
          total: beoeData.length
        });
      }

      /* ---------- Universal Table Downloader (Batch 2: detect only) ---------- */
      case 'table-downloader': {
        if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
        const operationParam = req.query.operation;
        const operation = Array.isArray(operationParam) ? operationParam[0] : operationParam;

        if (operation === 'detect') {
          const { url } = req.body || {};
          if (!url || typeof url !== 'string') return res.status(400).json({ error: 'url required' });
          try {
            const result = await detectTableAndPagination(url);
            return res.status(result.ok ? 200 : 422).json(result);
          } catch (execErr) {
            return res.status(500).json({ error: 'table-downloader error: ' + execErr.message });
          }
        }

        if (operation === 'fetch-page') {
          const { targetUrl, tableIndex, paginationType } = req.body || {};
          if (!targetUrl || typeof targetUrl !== 'string') return res.status(400).json({ error: 'targetUrl required' });
          const idx = Number.isInteger(tableIndex) ? tableIndex : 0;
          try {
            const result = await fetchSinglePage(targetUrl, idx, paginationType || null);
            return res.status(result.ok ? 200 : 422).json(result);
          } catch (execErr) {
            return res.status(500).json({ error: 'table-downloader error: ' + execErr.message });
          }
        }

        /* ---- Batch 5: light Job History / Source Registry (Supabase) ---- */
        if (operation === 'history-save') {
          if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
          const {
            url, hostname, tableIndex, pagination, headers, status,
            pagesFetched, pagesFailed, rowsFetched, duplicatesRemoved, rowsUnique
          } = req.body || {};
          if (!url || !hostname) return res.status(400).json({ error: 'url and hostname required' });
          try {
            const r = await fetch(`${SB()}/rest/v1/table_downloader_jobs`, {
              method: 'POST',
              headers: { ...sbHeaders(), 'Content-Type': 'application/json', Prefer: 'return=representation' },
              body: JSON.stringify([{
                url, hostname,
                table_index: Number.isInteger(tableIndex) ? tableIndex : null,
                pagination_strategy: pagination || null,
                headers: headers || null,
                status: status || 'UNKNOWN',
                pages_fetched: pagesFetched || 0,
                pages_failed: pagesFailed || 0,
                rows_fetched: rowsFetched || 0,
                duplicates_removed: duplicatesRemoved || 0,
                rows_unique: rowsUnique || 0
              }])
            });
            const data = await r.json();
            return res.status(r.status).json(data);
          } catch (execErr) {
            return res.status(500).json({ error: 'history-save error: ' + execErr.message });
          }
        }

        if (operation === 'history-list') {
          const urlParam = req.query.url;
          const urlFilter = urlParam ? (Array.isArray(urlParam) ? urlParam[0] : urlParam) : null;
          try {
            const endpoint = urlFilter
              ? `${SB()}/rest/v1/table_downloader_jobs?url=eq.${encodeURIComponent(urlFilter)}&order=created_at.desc&limit=1&select=*`
              : `${SB()}/rest/v1/table_downloader_jobs?order=created_at.desc&limit=20&select=*`;
            const r = await fetch(endpoint, { headers: sbHeaders() });
            const data = await r.json();
            return res.status(r.status).json(data);
          } catch (execErr) {
            return res.status(500).json({ error: 'history-list error: ' + execErr.message });
          }
        }

        return res.status(400).json({ error: 'Unknown or not-yet-implemented operation: ' + operation });
      }

      default:
        return res.status(404).json({ error: 'Unknown admin action: ' + action });
    }
  } catch (e) {
    return res.status(500).json({ error: e.message });
  }
}
