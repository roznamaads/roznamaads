const ALLOWED_FIELDS = ['title', 'city', 'description', 'price', 'contact_phone'];

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
  if (req.headers['x-admin-secret'] !== process.env.ADMIN_API_SECRET) {
    return res.status(401).json({ error: 'Unauthorized' });
  }
  const { id, fields } = req.body || {};
  if (!id || !fields) return res.status(400).json({ error: 'id and fields required' });

  const patch = {};
  for (const key of ALLOWED_FIELDS) {
    if (fields[key] !== undefined) patch[key] = fields[key];
  }
  if (Object.keys(patch).length === 0) return res.status(400).json({ error: 'No valid fields to update' });

  try {
    const r = await fetch(`${process.env.SUPABASE_URL}/rest/v1/ads?id=eq.${id}`, {
      method: 'PATCH',
      headers: {
        apikey: process.env.SUPABASE_SERVICE_KEY,
        Authorization: `Bearer ${process.env.SUPABASE_SERVICE_KEY}`,
        'Content-Type': 'application/json',
        Prefer: 'return=representation'
      },
      body: JSON.stringify(patch)
    });
    const data = await r.json();
    return res.status(r.status).json(data);
  } catch (e) {
    return res.status(500).json({ error: e.message });
  }
}
