// Serves blog.html with the article grid already rendered server-side, so
// crawlers/bots (and users with slow/no JS) see the actual article cards in
// the initial HTML instead of an empty <div id="blogGrid"></div> that only
// fills in after a client-side Supabase fetch runs. Same pattern as
// api/article-meta.js for /article.html — see that file's header comment
// for the full rationale (vercel.json rewrites ALL /blog.html requests here).
//
// IMPORTANT: The blog.html template is embedded below as a string (not read
// from disk), for the same reason as article-meta.js. If you edit blog.html,
// re-generate this embedded copy too. NOTE: a plain static blog.html file
// must NOT exist in the repo -- Vercel serves static files before checking
// rewrites, which would bypass this function entirely. This function IS the
// page.
//
// The client-side script keeps a `loadDataInsights()` fallback that only
// runs if the grid arrives empty (e.g. the Supabase fetch below failed at
// request time) -- so the page still works even if this SSR step fails.

const SUPABASE_URL = "https://sdmviikgmbwhsgrtxfqg.supabase.co";
const SUPABASE_ANON_KEY = "sb_publishable_BEYsdjr36__gXf9XxrSnlQ_8_df4TWZ";

const BLOG_HTML_TEMPLATE = "<!DOCTYPE html>\n<html lang=\"en\">\n<head>\n<meta charset=\"UTF-8\">\n<meta name=\"viewport\" content=\"width=device-width,initial-scale=1\">\n<title>__PAGE_TITLE__</title>\n<meta name=\"description\" content=\"__PAGE_DESC__\">\n<link rel=\"canonical\" href=\"__CANONICAL__\">\n<link rel=\"stylesheet\" href=\"styles.css\">\n<style>\n  .cat-chip-row{display:flex;flex-wrap:wrap;gap:6px;margin-bottom:14px}\n  .cat-chip{display:inline-block;padding:4px 12px;border-radius:999px;border:1px solid var(--line,#ddd);font-size:.75rem;color:var(--text,#333);background:#fff;text-decoration:none;white-space:nowrap}\n  .cat-chip.active{background:var(--green-deep,#166638);color:#fff;border-color:var(--green-deep,#166638)}\n  .cat-chip:hover{border-color:var(--green-deep,#166638)}\n</style>\n<script src=\"https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2\"></script>\n<script src=\"supabase-config.js\"></script>\n<script src=\"analytics-config.js\"></script>\n</head>\n<body>\n<a href=\"#main-content\" class=\"skip-link\">Skip to main content</a>\n\n<header class=\"hero\" style=\"padding:22px 18px\">\n  <div class=\"site-header-bar\">\n    <a href=\"index.html\" class=\"brand-row\"><img src=\"logo.svg\" alt=\"RoznamaAds.pk logo\" class=\"logo-img\">RoznamaAds<span style=\"opacity:.7\">.pk</span></a>\n  </div>\n    <nav class=\"site-top-nav\" aria-label=\"Main navigation\">\n    <a href=\"index.html\">Home</a>\n    <a href=\"verify.html\" class=\"nav-verify\">🛡️ Verify</a>\n    <a href=\"scam-checker.html\" class=\"nav-verify\">🔎 Scam Checker</a>\n    <a href=\"tenders.html\">Tenders</a>\n    <a href=\"blog.html\" class=\"active\">Blog</a>\n    <a href=\"rishta.html\" class=\"nav-rishta\">💘 Rishta</a>\n    <a href=\"submit-ad.html\" class=\"nav-submit\">📝 Submit Ad</a>\n  </nav>\n</header>\n\n<div class=\"site-ticker\">\n  <div class=\"site-ticker-track\">🛡️ FREE Scam &amp; Risk Checker — Housing Society, Visa Agency, Job, Institute ya Company check karein <strong>paisay dene se pehle</strong>! &nbsp; <a href=\"scam-checker.html\">Abhi Check Karein →</a> &nbsp; | &nbsp; 5,900+ government-verified records BEOE, HEC, PPRA se &nbsp; | &nbsp; <a href=\"verify.html\">Society/Visa Verify</a></div>\n</div>\n<div class=\"site-ticker\" style=\"background:#96354C;color:#fff\">\n  <div class=\"site-ticker-track\">💘 Naya! Rishta Board — Pakistani newspapers ke matrimonial classifieds se, <strong>verified aur bilkul free</strong> &nbsp; | &nbsp; <a href=\"rishta.html\" style=\"color:#fff;text-decoration:underline\">Abhi Dekhein →</a> &nbsp; | &nbsp; <a href=\"submit-ad.html\" style=\"color:#fff;text-decoration:underline\">Apni Rishta/Shaadi Ad Submit Karein →</a></div>\n</div>\n\n\n<div class=\"subheader\">\n  <div class=\"wrap\">\n    <div class=\"breadcrumb\"><a href=\"index.html\">Home</a> / <a href=\"blog.html\">Blog</a>__BREADCRUMB_EXTRA__</div>\n    <h1>__H1__</h1>\n  </div>\n</div>\n\n<main id=\"main-content\">\n  <p class=\"intro-text\" style=\"margin-bottom:18px\">RoznamaAds.pk ki data-journalism reports, government-record insights, aur classifieds guides — property, jobs, vehicles, rishta ads samajhne se lekar official data par mabni tajziye tak, sab ek jagah.</p>\n\n  <div class=\"cat-chip-row\" id=\"categoryChips\">__CATEGORY_CHIPS__</div>\n\n  <div class=\"blog-tabs\">\n    <button class=\"active\" data-filter=\"all\">Sab</button>\n    <button data-filter=\"insights\">📊 Data Insights</button>\n    <button data-filter=\"guides\">📘 Ads Guides</button>\n  </div>\n\n  <div class=\"blog-grid\" id=\"blogGrid\">__BLOG_CARDS__</div>\n</main>\n\n<footer>\n  <div class=\"wrap\">\n    <div class=\"foot-brand\"><img src=\"logo.svg\" alt=\"RoznamaAds.pk logo\" class=\"foot-logo-img\">RoznamaAds.pk</div>\n    <nav>\n      <a href=\"index.html\">Home</a>\n      <a href=\"submit-ad.html\">Submit Ad</a>\n      <a href=\"verify.html\">Society/Visa Verify</a>\n      <a href=\"scam-checker.html\">Scam Checker</a>\n      <a href=\"tenders.html\">Tenders</a>\n      <a href=\"blog.html\">Blog</a>\n      <a href=\"about.html\">About</a>\n      <a href=\"contact.html\">Contact</a>\n      <a href=\"privacy.html\">Privacy</a>\n      <a href=\"terms.html\">Terms</a>\n    </nav>\n    <p class=\"copy\">© 2026 RoznamaAds.pk — Pakistani Newspaper Classifieds, Digital.<br><a href=\"mailto:roznamaads@gmail.com\" class=\"foot-email\">roznamaads@gmail.com</a></p>\n  </div>\n</footer>\n\n<script>\nfunction escapeHtml(s){\n  return String(s||'').replace(/[&<>\\\"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','\\\"':'&quot;',\"'\":'&#39;'}[c]));\n}\nasync function loadDataInsights(){\n  const grid = document.getElementById('blogGrid');\n  try{\n    const catParam = new URLSearchParams(location.search).get('category');\n    let q = rzDb.from('articles')\n      .select('title, slug, summary, category')\n      .eq('published', true);\n    if(catParam) q = q.eq('category', catParam);\n    const { data: articles, error } = await q.order('published_at', { ascending: false }).limit(30);\n    if(error || !articles || articles.length === 0) return;\n    const cardsHtml = articles.map(a => {\n      const cat = (a.category || '').toLowerCase();\n      const isGuide = cat.includes('guide') || cat.includes('tip');\n      const tabCat = isGuide ? 'guides' : 'insights';\n      const tagLabel = isGuide ? '📘 Ads Guide' : '📊 Data Insights';\n      return `\n      <a class=\"blog-card\" href=\"article.html?slug=${encodeURIComponent(a.slug)}\" data-cat=\"${tabCat}\">\n        <span class=\"blog-tag\">${tagLabel}</span>\n        <h3>${escapeHtml(a.title)}</h3>\n        <p>${escapeHtml(a.summary || '')}</p>\n      </a>\n    `;\n    }).join('');\n    grid.insertAdjacentHTML('afterbegin', cardsHtml);\n  }catch(e){ /* silently ignore — static guides still show */ }\n}\n// Grid already has server-rendered cards in the normal case (see blog-meta.js).\n// Only hit Supabase again from the client if the SSR step above came up\n// empty (e.g. that fetch failed) -- avoids double-rendered duplicate cards.\nif(!document.getElementById('blogGrid').children.length){\n  loadDataInsights();\n}\n\ndocument.querySelectorAll('.blog-tabs button').forEach(btn => {\n  btn.addEventListener('click', () => {\n    document.querySelectorAll('.blog-tabs button').forEach(b => b.classList.remove('active'));\n    btn.classList.add('active');\n    const filter = btn.dataset.filter;\n    document.querySelectorAll('#blogGrid .blog-card').forEach(card => {\n      card.style.display = (filter === 'all' || card.dataset.cat === filter) ? 'flex' : 'none';\n    });\n  });\n});\n</script>\n</body>\n</html>\n";

function esc(str) {
  return String(str ?? '')
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

export default async function handler(req, res) {
  let cardsHtml = '';
  let chipsHtml = '';
  const categorySlug = (req.query.category || '').toString().trim();

  let categoryLabel = categorySlug;

  try {
    const catRes = await fetch(
      `${SUPABASE_URL}/rest/v1/article_categories?select=slug,label&order=label.asc`,
      { headers: { apikey: SUPABASE_ANON_KEY, Authorization: `Bearer ${SUPABASE_ANON_KEY}` } }
    );
    if (catRes.ok) {
      const cats = await catRes.json();
      const matched = (cats || []).find(c => c.slug === categorySlug);
      if (matched) categoryLabel = matched.label;
      chipsHtml = `<a href="blog.html" class="cat-chip${!categorySlug ? ' active' : ''}">Sab Categories</a>` +
        (cats || []).map(c => `<a href="blog.html?category=${encodeURIComponent(c.slug)}" class="cat-chip${categorySlug === c.slug ? ' active' : ''}">${esc(c.label)}</a>`).join('');
    }
  } catch (e) {
    // category chips optional — page still works without them
  }

  try {
    const filterQs = categorySlug ? `&category=eq.${encodeURIComponent(categorySlug)}` : '';
    const r = await fetch(
      `${SUPABASE_URL}/rest/v1/articles?published=eq.true${filterQs}&select=title,slug,summary,category&order=published_at.desc&limit=30`,
      { headers: { apikey: SUPABASE_ANON_KEY, Authorization: `Bearer ${SUPABASE_ANON_KEY}` } }
    );
    if (r.ok) {
      const articles = await r.json();
      cardsHtml = (articles || []).map(a => {
        const cat = (a.category || '').toLowerCase();
        const isGuide = cat.includes('guide') || cat.includes('tip');
        const tabCat = isGuide ? 'guides' : 'insights';
        const tagLabel = isGuide ? '📘 Ads Guide' : '📊 Data Insights';
        return `<a class="blog-card" href="article.html?slug=${encodeURIComponent(a.slug)}" data-cat="${tabCat}"><span class="blog-tag">${tagLabel}</span><h3>${esc(a.title)}</h3><p>${esc(a.summary || '')}</p></a>`;
      }).join('');
    }
  } catch (e) {
    // Supabase fetch failed -- fall back to empty grid; client-side
    // loadDataInsights() fallback in the template picks up the slack.
  }

  const pageTitle = categorySlug
    ? `${categoryLabel} — Blog | RoznamaAds.pk`
    : 'Blog & Data Reports | RoznamaAds.pk';
  const pageDesc = categorySlug
    ? `RoznamaAds.pk blog par "${categoryLabel}" category ke articles aur reports.`
    : 'RoznamaAds.pk ki data-journalism reports, government-record insights, aur classifieds guides — ek jagah.';
  const canonical = categorySlug
    ? `https://roznamaads.pk/blog.html?category=${encodeURIComponent(categorySlug)}`
    : 'https://roznamaads.pk/blog.html';
  const breadcrumbExtra = categorySlug ? ` / <span>${esc(categoryLabel)}</span>` : '';
  const h1 = categorySlug ? `${esc(categoryLabel)} — Articles` : 'Blog &amp; Data Reports';

  const html = BLOG_HTML_TEMPLATE
    .replace('__BLOG_CARDS__', cardsHtml)
    .replace('__CATEGORY_CHIPS__', chipsHtml)
    .replace(/__PAGE_TITLE__/g, esc(pageTitle))
    .replace(/__PAGE_DESC__/g, esc(pageDesc))
    .replace(/__CANONICAL__/g, canonical)
    .replace('__BREADCRUMB_EXTRA__', breadcrumbExtra)
    .replace('__H1__', h1);

  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  res.setHeader('Cache-Control', 's-maxage=300, stale-while-revalidate=600');
  res.status(200).send(html);
}
