export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
  if (req.headers['x-admin-secret'] !== process.env.ADMIN_API_SECRET) {
    return res.status(401).json({ error: 'Unauthorized' });
  }
  const { id, days } = req.body || {};
  if (!id) return res.status(400).json({ error: 'id required' });
  const extendDays = Number(days) || 30;

  try {
    // Fetch current expiry first
    const getRes = await fetch(`${process.env.SUPABASE_URL}/rest/v1/ads?id=eq.${id}&select=expires_at`, {
      headers: {
        apikey: process.env.SUPABASE_SERVICE_KEY,
        Authorization: `Bearer ${process.env.SUPABASE_SERVICE_KEY}`
      }
    });
    const rows = await getRes.json();
    if (!rows.length) return res.status(404).json({ error: 'Ad not found' });

    const base = rows[0].expires_at ? new Date(rows[0].expires_at) : new Date();
    const newExpiry = new Date(Math.max(base.getTime(), Date.now()) + extendDays * 24 * 60 * 60 * 1000);

    const patchRes = await fetch(`${process.env.SUPABASE_URL}/rest/v1/ads?id=eq.${id}`, {
      method: 'PATCH',
      headers: {
        apikey: process.env.SUPABASE_SERVICE_KEY,
        Authorization: `Bearer ${process.env.SUPABASE_SERVICE_KEY}`,
        'Content-Type': 'application/json',
        Prefer: 'return=representation'
      },
      body: JSON.stringify({ expires_at: newExpiry.toISOString(), status: 'live' })
    });
    const data = await patchRes.json();
    return res.status(patchRes.status).json(data);
  } catch (e) {
    return res.status(500).json({ error: e.message });
  }
}
