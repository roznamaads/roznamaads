export default async function handler(req, res) {
  // Vercel automatically sends this header for scheduled Cron invocations
  // when CRON_SECRET env var is set.
  if (req.headers['authorization'] !== `Bearer ${process.env.CRON_SECRET}`) {
    return res.status(401).json({ error: 'Unauthorized' });
  }
  try {
    const r = await fetch(
      `${process.env.SUPABASE_URL}/rest/v1/ads?status=eq.live&expires_at=lt.${new Date().toISOString()}`,
      {
        method: 'PATCH',
        headers: {
          apikey: process.env.SUPABASE_SERVICE_KEY,
          Authorization: `Bearer ${process.env.SUPABASE_SERVICE_KEY}`,
          'Content-Type': 'application/json',
          Prefer: 'return=representation'
        },
        body: JSON.stringify({ status: 'expired' })
      }
    );
    const data = await r.json();
    return res.status(r.status).json({ expired_count: Array.isArray(data) ? data.length : 0 });
  } catch (e) {
    return res.status(500).json({ error: e.message });
  }
}
