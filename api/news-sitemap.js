// Google News Sitemap — sirf time-sensitive articles (is_time_sensitive = true)
// jo pichle 48 ghanton mein publish hue hain (Google News guidelines ke mutabiq,
// News sitemap sirf recent items ke liye hoti hai, general sitemap.xml alag hai
// jo sab published articles ke liye already maujood hai — api/sitemap.js).

function esc(str) {
  return String(str ?? '')
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

export default async function handler(req, res) {
  let urls = [];

  try {
    const since = new Date(Date.now() - 48 * 60 * 60 * 1000).toISOString();
    const r = await fetch(
      `${process.env.SUPABASE_URL}/rest/v1/articles?published=eq.true&is_time_sensitive=eq.true&published_at=gte.${since}&select=title,slug,published_at&order=published_at.desc&limit=1000`,
      { headers: { apikey: 'sb_publishable_BEYsdjr36__gXf9XxrSnlQ_8_df4TWZ', Authorization: 'Bearer sb_publishable_BEYsdjr36__gXf9XxrSnlQ_8_df4TWZ' } }
    );
    if (r.ok) {
      const articles = await r.json();
      urls = articles || [];
    }
  } catch (e) {
    // fails safe — empty news sitemap if Supabase fetch fails
  }

  const xml = `<?xml version="1.0" encoding="UTF-8"?>\n` +
    `<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9" xmlns:news="http://www.google.com/schemas/sitemap-news/0.9">\n` +
    urls.map(a => `  <url>\n` +
      `    <loc>https://roznamaads.pk/article.html?slug=${encodeURIComponent(a.slug)}</loc>\n` +
      `    <news:news>\n` +
      `      <news:publication>\n` +
      `        <news:name>RoznamaAds.pk</news:name>\n` +
      `        <news:language>ur</news:language>\n` +
      `      </news:publication>\n` +
      `      <news:publication_date>${a.published_at}</news:publication_date>\n` +
      `      <news:title>${esc(a.title)}</news:title>\n` +
      `    </news:news>\n` +
      `  </url>`
    ).join('\n') +
    `\n</urlset>\n`;

  res.setHeader('Content-Type', 'application/xml');
  res.setHeader('Cache-Control', 's-maxage=600, stale-while-revalidate');
  return res.status(200).send(xml);
}
