// Server-rendered <head> meta tags for a single ad — used ONLY for link-preview
// bots (WhatsApp, Facebook, Twitter, etc.) which do not execute JavaScript, so
// they never see the tags that ad.html sets client-side after fetching from
// Supabase. Real visitors are bounced straight to the normal interactive
// ad.html page. See middleware.js for how requests get routed here.

const SUPABASE_URL = "https://sdmviikgmbwhsgrtxfqg.supabase.co";
const SUPABASE_ANON_KEY = "sb_publishable_BEYsdjr36__gXf9XxrSnlQ_8_df4TWZ";

const CAT_LABELS = {
  property: 'Property', jobs: 'Jobs', vehicles: 'Vehicles', matrimonial: 'Matrimonial / Rishta',
  visa: 'Visa & Immigration', auctions: 'Auctions', admissions: 'Admissions', tenders: 'Tenders',
  notices: 'Government / Public Notices', services: 'Services', electronics: 'Electronics'
};

function esc(str) {
  return String(str ?? '')
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

export default async function handler(req, res) {
  const id = (req.query.id || '').toString();
  const siteUrl = `https://roznamaads.pk`;
  const realUrl = id ? `${siteUrl}/ad.html?id=${encodeURIComponent(id)}` : `${siteUrl}/`;

  let title = 'RoznamaAds.pk — Newspaper Classified Ads Online';
  let description = 'Pakistani newspaper classifieds — digital aur searchable. Property, Jobs, Vehicles, Matrimonial, Visa, Auctions, Tenders.';
  let image = `${siteUrl}/logo.svg`;

  if (id) {
    try {
      const r = await fetch(
        `${SUPABASE_URL}/rest/v1/ads?id=eq.${encodeURIComponent(id)}&status=eq.live&select=title,city,price,description,category,images`,
        { headers: { apikey: SUPABASE_ANON_KEY, Authorization: `Bearer ${SUPABASE_ANON_KEY}` } }
      );
      const rows = await r.json();
      const ad = Array.isArray(rows) ? rows[0] : null;
      if (ad) {
        const catLabel = CAT_LABELS[ad.category] || ad.category;
        title = `${ad.title} — RoznamaAds.pk`;
        description = `${catLabel}${ad.city ? ' · ' + ad.city : ''}${ad.price ? ' · ' + ad.price : ''} — RoznamaAds.pk par dekhein.`;
        if (ad.images && ad.images.length) image = ad.images[0];
      }
    } catch (e) {
      // fall back to defaults below
    }
  }

  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  res.setHeader('Cache-Control', 's-maxage=300, stale-while-revalidate=600');
  res.status(200).send(`<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>${esc(title)}</title>
<meta name="description" content="${esc(description)}">
<link rel="canonical" href="${esc(realUrl)}">
<meta http-equiv="refresh" content="0; url=${esc(realUrl)}">
<meta property="og:title" content="${esc(title)}">
<meta property="og:description" content="${esc(description)}">
<meta property="og:type" content="website">
<meta property="og:url" content="${esc(realUrl)}">
<meta property="og:image" content="${esc(image)}">
<meta name="twitter:card" content="summary_large_image">
<meta name="twitter:title" content="${esc(title)}">
<meta name="twitter:description" content="${esc(description)}">
<meta name="twitter:image" content="${esc(image)}">
</head>
<body>
<script>location.replace(${JSON.stringify(realUrl)});</script>
<p>Redirecting to <a href="${esc(realUrl)}">${esc(title)}</a>…</p>
</body>
</html>`);
}
