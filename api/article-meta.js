// Serves article.html with server-side-correct <title>/OG/Twitter meta tags
// for a specific article slug, so link-preview bots (WhatsApp, Facebook, X)
// -- which do NOT execute JavaScript -- see the real article title/summary
// instead of generic placeholder text. vercel.json rewrites ALL /article.html
// requests here (bots and normal browsers both), so there's no unreliable
// user-agent guessing. The page's own client-side JS then loads and works
// exactly as before for real visitors.
//
// IMPORTANT: The article.html template is embedded below as a string (not
// read from disk) so this works regardless of how Vercel bundles static
// files for serverless functions. If you edit article.html, re-generate
// this embedded copy too (or the two will drift out of sync). NOTE: a plain
// static article.html file must NOT exist in the repo -- Vercel serves
// static files before checking rewrites, which would bypass this function
// entirely. This function IS the page.

const SUPABASE_URL = "https://sdmviikgmbwhsgrtxfqg.supabase.co";
const SUPABASE_ANON_KEY = "sb_publishable_BEYsdjr36__gXf9XxrSnlQ_8_df4TWZ";

const ARTICLE_HTML_TEMPLATE = "<!DOCTYPE html>\n<html lang=\"en\">\n<head>\n<meta charset=\"UTF-8\">\n<meta name=\"viewport\" content=\"width=device-width,initial-scale=1\">\n<title id=\"pageTitle\">Article — RoznamaAds.pk</title>\n<meta id=\"pageDesc\" name=\"description\" content=\"Data-driven article on RoznamaAds.pk\">\n<link id=\"canonicalLink\" rel=\"canonical\" href=\"https://roznamaads.pk/article.html\">\n<meta property=\"og:title\" id=\"ogTitle\" content=\"Article — RoznamaAds.pk\">\n<meta property=\"og:description\" id=\"ogDesc\" content=\"Data-driven article on RoznamaAds.pk\">\n<meta property=\"og:type\" content=\"article\">\n<meta property=\"og:url\" id=\"ogUrl\" content=\"https://roznamaads.pk/article.html\">\n<meta property=\"og:image\" id=\"ogImage\" content=\"https://roznamaads.pk/og-default.png\">\n<meta name=\"twitter:card\" content=\"summary_large_image\">\n<meta name=\"twitter:title\" id=\"twTitle\" content=\"Article — RoznamaAds.pk\">\n<meta name=\"twitter:description\" id=\"twDesc\" content=\"Data-driven article on RoznamaAds.pk\">\n<meta name=\"twitter:image\" id=\"twImage\" content=\"https://roznamaads.pk/og-default.png\">\n<link rel=\"stylesheet\" href=\"styles.css\">\n<script src=\"https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2\"></script>\n<script src=\"supabase-config.js\"></script>\n<script src=\"share-widget.js\"></script>\n<link rel=\"preconnect\" href=\"https://fonts.googleapis.com\">\n<link href=\"https://fonts.googleapis.com/css2?family=Noto+Nastaliq+Urdu:wght@400;600&display=swap\" rel=\"stylesheet\">\n<script src=\"https://cdn.jsdelivr.net/npm/chart.js@4\"></script>\n<script type=\"application/ld+json\" id=\"articleSchema\"></script>\n<style>\n  .article-body{ max-width:720px; margin:0 auto; font-size:1.15rem; line-height:2.1; color:var(--ink); font-family:'Noto Nastaliq Urdu', 'Jameel Noori Nastaleeq', serif; text-align:right }\n  .article-body h2{ font-size:1.5rem; margin-top:32px; color:var(--green-deep,#166638) }\n  .article-body h3{ font-size:1.25rem; margin-top:24px }\n  .article-body p{ margin:12px 0 }\n  .article-body ul,.article-body ol{ margin:12px 0; padding-left:22px }\n  .article-body table{ width:100%; border-collapse:collapse; margin:20px 0; font-size:1rem }\n  .article-body th{ background:#166638; color:#fff; text-align:right; padding:9px 12px }\n  .article-body td{ padding:8px 12px; border-bottom:1px solid var(--line); text-align:right }\n  .article-body tr:nth-child(even) td{ background:#f7f4ec }\n  .article-meta{ max-width:720px; margin:0 auto 18px; font-size:.85rem; color:var(--muted) }\n  .article-source{ max-width:720px; margin:24px auto 0; padding:12px 16px; background:var(--card-alt,#f5f2ea); border-radius:10px; font-size:.82rem; color:var(--muted) }\n  .article-chart-wrap{ max-width:720px; margin:26px auto; background:#fff; border:1px solid var(--line); border-radius:12px; padding:16px }\n</style>\n</head>\n<body>\n<a href=\"#main-content\" class=\"skip-link\">Skip to main content</a>\n\n<header class=\"hero\" style=\"padding:20px 18px\">\n  <div class=\"site-header-bar\">\n    <a href=\"index.html\" class=\"brand-row\"><img src=\"logo.svg\" alt=\"RoznamaAds.pk logo\" class=\"logo-img\">RoznamaAds<span style=\"opacity:.7\">.pk</span></a>\n  </div>\n  <nav class=\"site-top-nav\" aria-label=\"Main navigation\">\n    <a href=\"index.html\">Home</a>\n    <a href=\"verify.html\" class=\"nav-verify\">🛡️ Verify</a>\n    <a href=\"scam-checker.html\" class=\"nav-verify\">🔎 Scam Checker</a>\n    <a href=\"tenders.html\">Tenders</a>\n    <a href=\"blog.html\" class=\"active\">Blog</a>\n    <a href=\"rishta.html\" class=\"nav-rishta\">💘 Rishta</a>\n    <a href=\"submit-ad.html\" class=\"nav-submit\">📝 Submit Ad</a>\n  </nav>\n</header>\n\n<div class=\"site-ticker\">\n  <div class=\"site-ticker-track\">🛡️ FREE Scam &amp; Risk Checker — Housing Society, Visa Agency, Job, Institute ya Company check karein <strong>paisay dene se pehle</strong>! &nbsp; <a href=\"scam-checker.html\">Abhi Check Karein →</a> &nbsp; | &nbsp; 5,900+ government-verified records BEOE, HEC, PPRA se &nbsp; | &nbsp; <a href=\"verify.html\">Society/Visa Verify</a></div>\n</div>\n<div class=\"site-ticker\" style=\"background:#96354C;color:#fff\">\n  <div class=\"site-ticker-track\">💘 Naya! Rishta Board — Pakistani newspapers ke matrimonial classifieds se, <strong>verified aur bilkul free</strong> &nbsp; | &nbsp; <a href=\"rishta.html\" style=\"color:#fff;text-decoration:underline\">Abhi Dekhein →</a> &nbsp; | &nbsp; <a href=\"submit-ad.html\" style=\"color:#fff;text-decoration:underline\">Apni Rishta/Shaadi Ad Submit Karein →</a></div>\n</div>\n\n<div class=\"subheader\">\n  <div class=\"wrap\">\n    <div class=\"breadcrumb\"><a href=\"index.html\">Home</a> / <a href=\"blog.html\">Blog</a> / <span id=\"breadcrumbTitle\">Article</span></div>\n  </div>\n</div>\n\n<main id=\"main-content\" class=\"wrap\" style=\"padding:26px 18px 50px\">\n  <div id=\"articleStage\">\n    <p style=\"text-align:center;color:var(--muted)\">Load ho raha hai...</p>\n  </div>\n</main>\n\n<footer>\n  <div class=\"wrap\">\n    <div class=\"foot-brand\"><img src=\"logo.svg\" alt=\"RoznamaAds.pk logo\" class=\"foot-logo-img\">RoznamaAds.pk</div>\n    <nav>\n      <a href=\"index.html\">Home</a>\n      <a href=\"submit-ad.html\">Submit Ad</a>\n      <a href=\"verify.html\">Society/Visa Verify</a>\n      <a href=\"scam-checker.html\">Scam Checker</a>\n      <a href=\"tenders.html\">Tenders</a>\n      <a href=\"blog.html\">Blog</a>\n      <a href=\"about.html\">About</a>\n      <a href=\"contact.html\">Contact</a>\n      <a href=\"privacy.html\">Privacy</a>\n      <a href=\"terms.html\">Terms</a>\n    </nav>\n    <p class=\"copy\">© 2026 RoznamaAds.pk — Pakistani Newspaper Classifieds, Digital.<br><a href=\"mailto:roznamaads@gmail.com\" class=\"foot-email\">roznamaads@gmail.com</a></p>\n  </div>\n</footer>\n\n<script>\nfunction escapeHtml(s){\n  return String(s||'').replace(/[&<>\"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','\"':'&quot;',\"'\":'&#39;'}[c]));\n}\n\nasync function loadArticle(){\n  const params = new URLSearchParams(location.search);\n  const slug = params.get('slug');\n  const stage = document.getElementById('articleStage');\n  if(!slug){\n    stage.innerHTML = '<p style=\"text-align:center;color:var(--muted)\">Article nahi mila.</p>';\n    return;\n  }\n\n  const { data: article, error } = await rzDb.from('articles').select('*').eq('slug', slug).eq('published', true).single();\n  if(error || !article){\n    stage.innerHTML = '<p style=\"text-align:center;color:var(--muted)\">Ye article nahi mila ya abhi published nahi hai. <a href=\"blog.html\">Blog par wapas jayein</a>.</p>';\n    return;\n  }\n\n  document.title = article.title + ' — RoznamaAds.pk';\n  document.getElementById('pageTitle').textContent = article.title + ' — RoznamaAds.pk';\n  document.getElementById('pageDesc').setAttribute('content', article.summary || '');\n  document.getElementById('ogTitle').setAttribute('content', article.title);\n  document.getElementById('ogDesc').setAttribute('content', article.summary || '');\n  document.getElementById('ogUrl').setAttribute('content', 'https://roznamaads.pk/article.html?slug=' + slug);\n  document.getElementById('twTitle').setAttribute('content', article.title);\n  document.getElementById('twDesc').setAttribute('content', article.summary || '');\n  document.getElementById('canonicalLink').setAttribute('href', 'https://roznamaads.pk/article.html?slug=' + slug);\n  document.getElementById('breadcrumbTitle').textContent = article.title;\n\n  document.getElementById('articleSchema').textContent = JSON.stringify({\n    \"@context\": \"https://schema.org\",\n    \"@type\": \"Article\",\n    \"headline\": article.title,\n    \"description\": article.summary || '',\n    \"datePublished\": article.published_at || article.created_at,\n    \"author\": { \"@type\": \"Organization\", \"name\": \"RoznamaAds.pk\" },\n    \"publisher\": { \"@type\": \"Organization\", \"name\": \"RoznamaAds.pk\" }\n  });\n\n  const chartHtml = article.chart_data ? `<div class=\"article-chart-wrap\"><canvas id=\"artChart\"></canvas></div>` : '';\n\n  stage.innerHTML = `\n    <h1 dir=\"rtl\" style=\"max-width:720px;margin:0 auto 8px;font-size:1.9rem;color:var(--green-deep,#166638);font-family:'Noto Nastaliq Urdu',serif;text-align:right\">${escapeHtml(article.title)}</h1>\n    <p class=\"article-meta\" style=\"text-align:center\">${new Date(article.published_at || article.created_at).toLocaleDateString('en-GB', {day:'numeric',month:'long',year:'numeric'})}</p>\n    <div style=\"max-width:720px;margin:0 auto 16px;text-align:center\"><div id=\"shareWidget\" style=\"display:inline-block\"></div></div>\n    <div class=\"article-body\" dir=\"rtl\">${article.body_html}</div>\n    ${chartHtml}\n    <div id=\"toolnestWidget\" style=\"max-width:720px;margin:20px auto 0\"></div>\n  `;\n\n  renderShareWidget('shareWidget', {\n    url: `https://roznamaads.pk/article.html?slug=${encodeURIComponent(slug)}`,\n    title: article.title\n  });\n\n  if(article.chart_data){\n    const cd = article.chart_data;\n    new Chart(document.getElementById('artChart'), {\n      type: cd.type || 'bar',\n      data: { labels: cd.labels || [], datasets: cd.datasets || [] },\n      options: { responsive: true }\n    });\n  }\n\n  loadToolnestWidget(article.toolnest_category, article.toolnest_tool_slug);\n}\n\nconst ARTICLE_TOOLNEST_INTROS = {\n  property: \"Property calculations chahiye? Ye free tool try karein:\",\n  jobs: \"Job apply karte waqt ye kaam aa sakta hai:\",\n  matrimonial: \"Rishta process ko asaan banane ke liye:\",\n  electronics: \"Photos ke liye ye free tool istemal karein:\",\n  services: \"Apni service business ke liye ye tool try karein:\",\n  visa: \"Visa documents taiyar karne mein madad ke liye:\",\n  auctions: \"Auction documents scan/organize karne ke liye:\",\n  admissions: \"Admission documents taiyar karne ke liye:\",\n  tenders: \"Tender documents scan/organize karne ke liye:\"\n};\n\nasync function loadToolnestWidget(catKey, toolSlug){\n  if(!catKey) return;\n  try{\n    const res = await fetch('toolnest-tools.json');\n    const map = await res.json();\n    const tools = map[catKey];\n    if(!tools || tools.length === 0) return;\n    // Agar admin ne specific tool select kiya ho to wahi dikhao, warna category se random\n    const tool = (toolSlug && tools.find(t => t.slug === toolSlug)) || tools[Math.floor(Math.random() * tools.length)];\n    const intro = ARTICLE_TOOLNEST_INTROS[catKey] || \"Ye related free tool try karein:\";\n    const toolUrl = `https://toolnest.link/${tool.slug}.html`;\n    document.getElementById('toolnestWidget').innerHTML = `\n      <a class=\"toolnest-card\" href=\"${toolUrl}\" target=\"_blank\" rel=\"noopener\">\n        <div class=\"tn-card-icon\">🧰</div>\n        <div class=\"tn-card-text\">\n          <p class=\"tn-label\">${intro}</p>\n          <p class=\"tn-tool-name\">${tool.name} <span class=\"tn-arrow\">↗</span></p>\n          <p class=\"tn-credit\">Powered by ToolNest — 99 free tools</p>\n        </div>\n      </a>\n    `;\n  }catch(e){ /* widget is optional; fail silently */ }\n}\n\nloadArticle();\n</script>\n</body>\n</html>\n";

function esc(str) {
  return String(str ?? '')
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

export default async function handler(req, res) {
  const slug = (req.query.slug || '').toString();
  const siteUrl = 'https://roznamaads.pk';
  const pageUrl = slug ? `${siteUrl}/article.html?slug=${encodeURIComponent(slug)}` : `${siteUrl}/article.html`;

  let title = 'Article — RoznamaAds.pk';
  let description = 'Data-driven article on RoznamaAds.pk';
  let image = `${siteUrl}/og-default.png`;

  if (slug) {
    try {
      const r = await fetch(
        `${SUPABASE_URL}/rest/v1/articles?slug=eq.${encodeURIComponent(slug)}&published=eq.true&select=title,summary`,
        { headers: { apikey: SUPABASE_ANON_KEY, Authorization: `Bearer ${SUPABASE_ANON_KEY}` } }
      );
      const rows = await r.json();
      const article = Array.isArray(rows) ? rows[0] : null;
      if (article) {
        title = `${article.title} — RoznamaAds.pk`;
        description = article.summary || description;
      }
    } catch (e) {
      // Supabase fetch failed -- fall back to generic defaults set above
    }
  }

  const html = ARTICLE_HTML_TEMPLATE
    .replace(
      '<title id="pageTitle">Article — RoznamaAds.pk</title>',
      `<title id="pageTitle">${esc(title)}</title>`
    )
    .replace(
      '<meta id="pageDesc" name="description" content="Data-driven article on RoznamaAds.pk">',
      `<meta id="pageDesc" name="description" content="${esc(description)}">`
    )
    .replace(
      '<link id="canonicalLink" rel="canonical" href="https://roznamaads.pk/article.html">',
      `<link id="canonicalLink" rel="canonical" href="${esc(pageUrl)}">`
    )
    .replace(
      '<meta property="og:title" id="ogTitle" content="Article — RoznamaAds.pk">',
      `<meta property="og:title" id="ogTitle" content="${esc(title)}">`
    )
    .replace(
      '<meta property="og:description" id="ogDesc" content="Data-driven article on RoznamaAds.pk">',
      `<meta property="og:description" id="ogDesc" content="${esc(description)}">`
    )
    .replace(
      '<meta property="og:url" id="ogUrl" content="https://roznamaads.pk/article.html">',
      `<meta property="og:url" id="ogUrl" content="${esc(pageUrl)}">`
    )
    .replace(
      '<meta property="og:image" id="ogImage" content="https://roznamaads.pk/og-default.png">',
      `<meta property="og:image" id="ogImage" content="${esc(image)}">`
    )
    .replace(
      '<meta name="twitter:title" id="twTitle" content="Article — RoznamaAds.pk">',
      `<meta name="twitter:title" id="twTitle" content="${esc(title)}">`
    )
    .replace(
      '<meta name="twitter:description" id="twDesc" content="Data-driven article on RoznamaAds.pk">',
      `<meta name="twitter:description" id="twDesc" content="${esc(description)}">`
    )
    .replace(
      '<meta name="twitter:image" id="twImage" content="https://roznamaads.pk/og-default.png">',
      `<meta name="twitter:image" id="twImage" content="${esc(image)}">`
    );

  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  res.setHeader('Cache-Control', 's-maxage=300, stale-while-revalidate=600');
  res.status(200).send(html);
}
