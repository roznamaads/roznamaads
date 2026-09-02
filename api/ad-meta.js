// Serves ad.html with server-side-correct <title>/OG/Twitter meta tags for a
// specific ad id, so link-preview bots (WhatsApp, Facebook, etc.) — which do
// NOT execute JavaScript — see the real ad title/price/city/photo instead of
// generic placeholder text. vercel.json rewrites ALL /ad.html requests here
// (bots and normal browsers both), so there's no unreliable user-agent
// guessing. The page's own client-side JS then loads and works exactly as
// before for real visitors.

import fs from 'fs';
import path from 'path';

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
  const siteUrl = 'https://roznamaads.pk';
  const pageUrl = id ? `${siteUrl}/ad.html?id=${encodeURIComponent(id)}` : `${siteUrl}/ad.html`;

  let title = 'Ad Details — RoznamaAds.pk';
  let description = 'View full classified ad details on RoznamaAds.pk';
  let image = `${siteUrl}/logo.svg`;

  if (id) {
    try {
      const r = await fetch(
        `${SUPABASE_URL}/rest/v1/ads?id=eq.${encodeURIComponent(id)}&status=eq.live&select=title,city,price,category,images`,
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
      // Supabase fetch failed — fall back to generic defaults set above
    }
  }

  let html;
  try {
    html = fs.readFileSync(path.join(process.cwd(), 'ad.html'), 'utf8');
  } catch (e) {
    // Template couldn't be read — bounce to the client-rendered page rather than error out
    res.setHeader('Location', pageUrl);
    return res.status(302).end();
  }

  html = html
    .replace(
      '<title id="pageTitle">Ad Details — RoznamaAds.pk</title>',
      `<title id="pageTitle">${esc(title)}</title>`
    )
    .replace(
      '<meta id="pageDesc" name="description" content="View full classified ad details on RoznamaAds.pk">',
      `<meta id="pageDesc" name="description" content="${esc(description)}">`
    )
    .replace(
      '<link id="canonicalLink" rel="canonical" href="https://roznamaads.pk/ad.html">',
      `<link id="canonicalLink" rel="canonical" href="${esc(pageUrl)}">`
    )
    .replace(
      '<meta property="og:title" id="ogTitle" content="Ad Details — RoznamaAds.pk">',
      `<meta property="og:title" id="ogTitle" content="${esc(title)}">`
    )
    .replace(
      '<meta property="og:description" id="ogDesc" content="View full classified ad details on RoznamaAds.pk">',
      `<meta property="og:description" id="ogDesc" content="${esc(description)}">`
    )
    .replace(
      '<meta property="og:url" id="ogUrl" content="https://roznamaads.pk/ad.html">',
      `<meta property="og:url" id="ogUrl" content="${esc(pageUrl)}">`
    )
    .replace(
      '<meta property="og:image" id="ogImage" content="https://roznamaads.pk/logo.svg">',
      `<meta property="og:image" id="ogImage" content="${esc(image)}">\n<meta name="twitter:card" content="summary_large_image">\n<meta name="twitter:title" content="${esc(title)}">\n<meta name="twitter:description" content="${esc(description)}">\n<meta name="twitter:image" content="${esc(image)}">`
    );

  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  res.setHeader('Cache-Control', 's-maxage=300, stale-while-revalidate=600');
  res.status(200).send(html);
}
