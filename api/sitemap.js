export default async function handler(req, res) {
  const staticUrls = [
    { loc: 'https://roznamaads.pk/', freq: 'daily', priority: '1.0' },
    { loc: 'https://roznamaads.pk/search.html', freq: 'daily', priority: '0.6' },
    { loc: 'https://roznamaads.pk/submit-ad.html', freq: 'weekly', priority: '0.8' },
    { loc: 'https://roznamaads.pk/about.html', freq: 'monthly', priority: '0.4' },
    { loc: 'https://roznamaads.pk/contact.html', freq: 'monthly', priority: '0.4' },
    { loc: 'https://roznamaads.pk/privacy.html', freq: 'yearly', priority: '0.2' },
    { loc: 'https://roznamaads.pk/terms.html', freq: 'yearly', priority: '0.2' }
  ];

  let categoryUrls = [];
  let adUrls = [];

  try {
    const catRes = await fetch('https://roznamaads.pk/categories.json');
    const cats = await catRes.json();
    categoryUrls = cats.filter(c => c.active).map(c => ({
      loc: `https://roznamaads.pk/category.html?cat=${c.id}`, freq: 'daily', priority: '0.8'
    }));
  } catch (e) { /* fall back to static-only sitemap */ }

  try {
    const adsRes = await fetch(
      `${process.env.SUPABASE_URL}/rest/v1/ads?status=eq.live&select=id,created_at&order=created_at.desc&limit=1000`,
      { headers: { apikey: 'sb_publishable_BEYsdjr36__gXf9XxrSnlQ_8_df4TWZ', Authorization: 'Bearer sb_publishable_BEYsdjr36__gXf9XxrSnlQ_8_df4TWZ' } }
    );
    if (adsRes.ok) {
      const ads = await adsRes.json();
      adUrls = ads.map(ad => ({
        loc: `https://roznamaads.pk/ad.html?id=${ad.id}`,
        lastmod: ad.created_at ? ad.created_at.split('T')[0] : undefined,
        freq: 'weekly', priority: '0.6'
      }));
    }
  } catch (e) { /* ads section stays empty if this fails */ }

  const all = [...staticUrls, ...categoryUrls, ...adUrls];
  const xml = `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n` +
    all.map(u => `  <url><loc>${u.loc}</loc>${u.lastmod ? `<lastmod>${u.lastmod}</lastmod>` : ''}<changefreq>${u.freq}</changefreq><priority>${u.priority}</priority></url>`).join('\n') +
    `\n</urlset>\n`;

  res.setHeader('Content-Type', 'application/xml');
  res.setHeader('Cache-Control', 's-maxage=3600, stale-while-revalidate');
  return res.status(200).send(xml);
}
