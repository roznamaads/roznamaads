const VALID_CATEGORIES = [
  'property','jobs','vehicles','matrimonial','visa','auctions',
  'admissions','tenders','notices','services','electronics'
];

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
  if (req.headers['x-admin-secret'] !== process.env.ADMIN_API_SECRET) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  const { category, title, city, price, description, contact_phone, extra_fields } = req.body || {};
  if (!category || !VALID_CATEGORIES.includes(category)) return res.status(400).json({ error: 'Valid category required' });
  if (!title || !title.trim()) return res.status(400).json({ error: 'title required' });
  if (!description || !description.trim()) return res.status(400).json({ error: 'description required' });

  const row = {
    category,
    title: title.trim(),
    city: (city || '').trim(),
    price: (price || '').trim(),
    description: description.trim(),
    contact_phone: (contact_phone || '').trim(),
    images: [],
    extra_fields: extra_fields && typeof extra_fields === 'object' ? extra_fields : {},
    submitted_name: 'AI Draft (Ad Post Generator)',
    status: 'pending'
  };

  try {
    const r = await fetch(`${process.env.SUPABASE_URL}/rest/v1/ads`, {
      method: 'POST',
      headers: {
        apikey: process.env.SUPABASE_SERVICE_KEY,
        Authorization: `Bearer ${process.env.SUPABASE_SERVICE_KEY}`,
        'Content-Type': 'application/json',
        Prefer: 'return=representation'
      },
      body: JSON.stringify(row)
    });
    const data = await r.json();
    return res.status(r.status).json(data);
  } catch (e) {
    return res.status(500).json({ error: e.message });
  }
}
