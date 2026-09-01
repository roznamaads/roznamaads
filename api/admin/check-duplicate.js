export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
  if (req.headers['x-admin-secret'] !== process.env.ADMIN_API_SECRET) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  const { title, contact_phone, category } = req.body || {};
  if ((!title || !title.trim()) && (!contact_phone || !contact_phone.trim())) {
    return res.status(400).json({ error: 'title ya contact_phone zaroori hai' });
  }

  const headers = {
    apikey: process.env.SUPABASE_SERVICE_KEY,
    Authorization: `Bearer ${process.env.SUPABASE_SERVICE_KEY}`
  };
  const base = `${process.env.SUPABASE_URL}/rest/v1/ads`;
  const matches = new Map();

  try {
    if (contact_phone && contact_phone.trim()) {
      const url = `${base}?contact_phone=eq.${encodeURIComponent(contact_phone.trim())}&status=in.(live,pending)&select=id,title,city,contact_phone,status,created_at,category`;
      const r = await fetch(url, { headers });
      const rows = await r.json();
      if (Array.isArray(rows)) rows.forEach(row => matches.set(row.id, { ...row, matchedBy: 'phone' }));
    }

    if (title && title.trim()) {
      const words = title.trim().split(/\s+/).filter(w => w.length > 2).slice(0, 2);
      if (words.length) {
        const pattern = '*' + words.join('*') + '*';
        let url = `${base}?title=ilike.${encodeURIComponent(pattern)}&status=in.(live,pending)&select=id,title,city,contact_phone,status,created_at,category`;
        if (category) url += `&category=eq.${encodeURIComponent(category)}`;
        const r = await fetch(url, { headers });
        const rows = await r.json();
        if (Array.isArray(rows)) rows.forEach(row => {
          if (!matches.has(row.id)) matches.set(row.id, { ...row, matchedBy: 'title' });
        });
      }
    }

    return res.status(200).json({ matches: Array.from(matches.values()) });
  } catch (e) {
    return res.status(500).json({ error: e.message });
  }
}
