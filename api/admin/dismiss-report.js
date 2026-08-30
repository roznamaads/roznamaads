export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
  if (req.headers['x-admin-secret'] !== process.env.ADMIN_API_SECRET) {
    return res.status(401).json({ error: 'Unauthorized' });
  }
  const { id } = req.body || {};
  if (!id) return res.status(400).json({ error: 'id required' });

  try {
    const r = await fetch(`${process.env.SUPABASE_URL}/rest/v1/ad_reports?id=eq.${id}`, {
      method: 'DELETE',
      headers: {
        apikey: process.env.SUPABASE_SERVICE_KEY,
        Authorization: `Bearer ${process.env.SUPABASE_SERVICE_KEY}`
      }
    });
    return res.status(r.status).json({ ok: r.ok });
  } catch (e) {
    return res.status(500).json({ error: e.message });
  }
}
