export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
  if (req.headers['x-admin-secret'] !== process.env.ADMIN_API_SECRET) {
    return res.status(401).json({ error: 'Unauthorized' });
  }
  const { id, status } = req.body || {};
  if (!id || !status) return res.status(400).json({ error: 'id and status required' });

  const body = { status };
  if (status === 'live') body.approved_at = new Date().toISOString();

  try {
    const r = await fetch(`${process.env.SUPABASE_URL}/rest/v1/ads?id=eq.${id}`, {
      method: 'PATCH',
      headers: {
        apikey: process.env.SUPABASE_SERVICE_KEY,
        Authorization: `Bearer ${process.env.SUPABASE_SERVICE_KEY}`,
        'Content-Type': 'application/json',
        Prefer: 'return=representation'
      },
      body: JSON.stringify(body)
    });
    const data = await r.json();
    return res.status(r.status).json(data);
  } catch (e) {
    return res.status(500).json({ error: e.message });
  }
}
