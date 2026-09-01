// Consolidated admin API — sab admin actions ek hi serverless function mein
// (Vercel Hobby plan sirf 12 functions allow karta hai, isliye sab merge kiya gaya hai)
// Routes: /api/admin/<action> — vercel.json ke rewrite se yahan aata hai, e.g. /api/admin/list?status=pending

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

      default:
        return res.status(404).json({ error: 'Unknown admin action: ' + action });
    }
  } catch (e) {
    return res.status(500).json({ error: e.message });
  }
}
