export default async function handler(req, res) {
  if (req.headers['x-admin-secret'] !== process.env.ADMIN_API_SECRET) {
    return res.status(401).json({ error: 'Unauthorized' });
  }
  try {
    const r = await fetch(
      `${process.env.SUPABASE_URL}/rest/v1/ads?select=id,category,city,status,created_at`,
      {
        headers: {
          apikey: process.env.SUPABASE_SERVICE_KEY,
          Authorization: `Bearer ${process.env.SUPABASE_SERVICE_KEY}`
        }
      }
    );
    const ads = await r.json();
    if (!Array.isArray(ads)) return res.status(500).json({ error: 'Unexpected response from database' });

    const byStatus = {};
    const byCategory = {};
    const byCity = {};
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
      total: ads.length,
      byStatus,
      byCategory: sortDesc(byCategory),
      byCity: sortDesc(byCity).slice(0, 8),
      last7,
      last30
    });
  } catch (e) {
    return res.status(500).json({ error: e.message });
  }
}
