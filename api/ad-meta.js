// Serves ad.html with server-side-correct <title>/OG/Twitter meta tags for a
// specific ad id, so link-preview bots (WhatsApp, Facebook, etc.) -- which do
// NOT execute JavaScript -- see the real ad title/price/city/photo instead of
// generic placeholder text. vercel.json rewrites ALL /ad.html requests here
// (bots and normal browsers both), so there's no unreliable user-agent
// guessing. The page's own client-side JS then loads and works exactly as
// before for real visitors.
//
// IMPORTANT: The ad.html template is embedded below as a string (not read
// from disk) so this works regardless of how Vercel bundles static files for
// serverless functions. If you edit ad.html's <head> or overall structure,
// re-generate this embedded copy too, or the two will drift out of sync.

const SUPABASE_URL = "https://sdmviikgmbwhsgrtxfqg.supabase.co";
const SUPABASE_ANON_KEY = "sb_publishable_BEYsdjr36__gXf9XxrSnlQ_8_df4TWZ";

const CAT_LABELS = {
  property: 'Property', jobs: 'Jobs', vehicles: 'Vehicles', matrimonial: 'Matrimonial / Rishta',
  visa: 'Visa & Immigration', auctions: 'Auctions', admissions: 'Admissions', tenders: 'Tenders',
  notices: 'Government / Public Notices', services: 'Services', electronics: 'Electronics'
};

const AD_HTML_TEMPLATE = "<!DOCTYPE html>\n<html lang=\"en\">\n<head>\n<meta charset=\"UTF-8\">\n<meta name=\"viewport\" content=\"width=device-width,initial-scale=1\">\n<title id=\"pageTitle\">Ad Details \u2014 RoznamaAds.pk</title>\n<meta id=\"pageDesc\" name=\"description\" content=\"View full classified ad details on RoznamaAds.pk\">\n<link id=\"canonicalLink\" rel=\"canonical\" href=\"https://roznamaads.pk/ad.html\">\n<meta property=\"og:title\" id=\"ogTitle\" content=\"Ad Details \u2014 RoznamaAds.pk\">\n<meta property=\"og:description\" id=\"ogDesc\" content=\"View full classified ad details on RoznamaAds.pk\">\n<meta property=\"og:type\" content=\"website\">\n<meta property=\"og:url\" id=\"ogUrl\" content=\"https://roznamaads.pk/ad.html\">\n<meta property=\"og:image\" id=\"ogImage\" content=\"https://roznamaads.pk/logo.svg\">\n<link rel=\"stylesheet\" href=\"styles.css\">\n<script src=\"https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2\"></script>\n<script src=\"supabase-config.js\"></script>\n<script src=\"analytics-config.js\"></script>\n<script src=\"badges.js\"></script>\n</head>\n<body>\n<a href=\"#main-content\" class=\"skip-link\">Skip to main content</a>\n\n<header class=\"hero\" style=\"padding:20px 18px\">\n  <div class=\"site-header-bar\">\n    <a href=\"index.html\" class=\"brand-row\"><img src=\"logo.svg\" alt=\"RoznamaAds.pk logo\" class=\"logo-img\">RoznamaAds<span style=\"opacity:.7\">.pk</span></a>\n  </div>\n</header>\n\n<div class=\"subheader\">\n  <div class=\"wrap\">\n    <div class=\"breadcrumb\">\n      <a href=\"index.html\">Home</a> / <a id=\"breadcrumbCatLink\" href=\"category.html\">Category</a> / <span id=\"breadcrumbAd\">Ad</span>\n    </div>\n  </div>\n</div>\n\n<main id=\"main-content\" style=\"margin-top:22px\">\n\n  <div class=\"ad-detail-card\">\n    <div class=\"ad-detail-imgbox\" id=\"adImgBox\" aria-hidden=\"true\">\ud83d\uddbc\ufe0f</div>\n    <div class=\"ad-detail-body\">\n      <span class=\"cat-tag\" id=\"adCatTag\">Category</span>\n      <div class=\"ad-detail-badges\" id=\"adBadges\"></div>\n      <h1 id=\"adTitle\">Ad Title</h1>\n      <p class=\"ad-detail-meta\" id=\"adMeta\">City \u00b7 Date</p>\n      <p class=\"ad-detail-price\" id=\"adPrice\"></p>\n\n      <div class=\"ad-detail-desc\">\n        <h2>Description</h2>\n        <p id=\"adDesc\">Is ad ki tafseel abhi placeholder hai \u2014 real newspaper data connect hone ke baad yahan asal description dikhegi.</p>\n      </div>\n\n      <div id=\"adTableBox\" style=\"display:none;margin:16px 0\">\n        <h2>Details</h2>\n        <div style=\"overflow-x:auto\">\n          <table class=\"ad-table\" id=\"adTable\"></table>\n        </div>\n      </div>\n\n      <div class=\"ad-detail-desc\" id=\"adUrduBox\" style=\"display:none\">\n        <h2>\u062e\u0644\u0627\u0635\u06c1 (Roman Urdu)</h2>\n        <p id=\"adDescUrdu\"></p>\n      </div>\n\n      <div class=\"contact-box\">\n        <h2>Contact</h2>\n        <p class=\"masked-number\" id=\"adPhone\">0300-XXX-1234</p>\n        <div class=\"contact-btns\">\n          <button class=\"btn-reveal\" id=\"revealBtn\">\ud83d\udcde Reveal Number</button>\n          <a class=\"btn-whatsapp\" href=\"#\" id=\"waBtn\">\ud83d\udcac WhatsApp</a>\n        </div>\n        <p class=\"disclaimer\">Number pehle masked hai privacy ke liye \u2014 \"Reveal\" par click karke dekhein. RoznamaAds ad ki tasdeeq ki zimmedar nahi.</p>\n      </div>\n\n      <button class=\"btn-report\" id=\"reportBtn\">\ud83d\udea9 Report this ad</button>\n\n      <div id=\"toolnestWidget\"></div>\n    </div>\n  </div>\n\n  <div class=\"section-title\"><h2>Related Ads</h2></div>\n  <div class=\"ad-grid\" id=\"relatedAds\">\n    <div class=\"ad-card\"><span class=\"cat-tag\">Property</span><h4>7 Marla House \u2014 Bahria Town, Rawalpindi</h4><span class=\"meta\">Rawalpindi \u00b7 Sample listing</span></div>\n    <div class=\"ad-card\"><span class=\"cat-tag\">Property</span><h4>1 Kanal Plot \u2014 Model Town, Lahore</h4><span class=\"meta\">Lahore \u00b7 Sample listing</span></div>\n    <div class=\"ad-card\"><span class=\"cat-tag\">Property</span><h4>Commercial Shop for Rent \u2014 Blue Area</h4><span class=\"meta\">Islamabad \u00b7 Sample listing</span></div>\n  </div>\n\n</main>\n\n<footer>\n  <div class=\"wrap\">\n    <div class=\"foot-brand\"><img src=\"logo.svg\" alt=\"RoznamaAds.pk logo\" class=\"foot-logo-img\">RoznamaAds.pk</div>\n    <nav>\n      <a href=\"index.html\">Home</a>\n      <a href=\"submit-ad.html\">Submit Ad</a>\n      <a href=\"blog.html\">Blog</a>\n      <a href=\"about.html\">About</a>\n      <a href=\"contact.html\">Contact</a>\n      <a href=\"privacy.html\">Privacy</a>\n      <a href=\"terms.html\">Terms</a>\n    </nav>\n    <p class=\"copy\">\u00a9 2026 RoznamaAds.pk \u2014 Pakistani Newspaper Classifieds, Digital.<br><a href=\"mailto:roznamaads@gmail.com\" class=\"foot-email\">roznamaads@gmail.com</a></p>\n  </div>\n</footer>\n\n<script>\nlet CATEGORIES = {};\n\nfetch('categories.json').then(r => r.json()).then(cats => {\n  cats.forEach(c => CATEGORIES[c.id] = {label: c.label});\n  initAdPage();\n}).catch(() => { initAdPage(); });\n\nfunction initAdPage(){\n  const params = new URLSearchParams(location.search);\n  const adId = params.get('id');\n\n  if(adId){\n    loadRealAd(adId);\n  } else {\n    const sampleCatKey = (params.get('cat')||'property').toLowerCase();\n    renderAd({\n      category: CATEGORIES[sampleCatKey] || {label:\"Category\"},\n      catKey: sampleCatKey,\n      title: \"10 Marla Plot \u2014 DHA Phase 6, Lahore\",\n      city: \"Lahore\",\n      date: \"29 Aug 2026\",\n      price: \"PKR 1.85 Crore\",\n      phoneMasked: \"0300-XXX-4521\",\n      description: \"Is ad ki tafseel abhi placeholder hai \u2014 real newspaper data connect hone ke baad yahan asal description dikhegi.\",\n      isSample: true\n    });\n  }\n}\n\nasync function loadRealAd(id){\n  try{\n    const { data, error } = await rzDb.from('ads').select('*').eq('id', id).eq('status', 'live').single();\n    if(error || !data) throw error || new Error('not found');\n    const phone = data.contact_phone || '';\n    const masked = phone.length > 4 ? phone.slice(0,4) + '-XXX-' + phone.slice(-4) : '0300-XXX-XXXX';\n    renderAd({\n      category: CATEGORIES[data.category] || {label:data.category},\n      catKey: data.category,\n      title: data.title,\n      city: data.city,\n      date: new Date(data.created_at).toLocaleDateString('en-GB'),\n      price: data.price || '',\n      phoneMasked: masked,\n      phoneFull: phone,\n      description: data.description,\n      images: data.images || [],\n      extraFields: data.extra_fields || {},\n      isSample: false\n    });\n  }catch(e){\n    document.querySelector('main').innerHTML = `<div class=\"empty-state\"><div class=\"icon\">\u274c</div>Ye ad nahi mili \u2014 ho sakta hai expire ho gayi ho ya remove kar di gayi ho. <a href=\"index.html\">Home par wapas jayein</a>.</div>`;\n  }\n}\n\nfunction renderAd(ad){\n  document.getElementById('pageTitle').textContent = ad.title + \" \u2014 RoznamaAds.pk\";\n  document.getElementById('pageDesc').setAttribute('content', ad.title + \" \u2014 \" + ad.category.label + \" ad on RoznamaAds.pk\");\n  document.getElementById('ogTitle').setAttribute('content', ad.title + \" \u2014 RoznamaAds.pk\");\n  document.getElementById('ogDesc').setAttribute('content', ad.category.label + (ad.city ? ' \u00b7 ' + ad.city : '') + (ad.price ? ' \u00b7 ' + ad.price : ''));\n  document.getElementById('ogUrl').setAttribute('content', location.href);\n  if(ad.images && ad.images.length) document.getElementById('ogImage').setAttribute('content', ad.images[0]);\n  document.getElementById('adCatTag').textContent = ad.category.label;\n  document.getElementById('adBadges').innerHTML = rzBadgesHtml(ad.catKey, ad.extraFields);\n  document.getElementById('breadcrumbCatLink').textContent = ad.category.label;\n  document.getElementById('breadcrumbCatLink').href = 'category.html?cat=' + (ad.catKey || '');\n  document.getElementById('breadcrumbAd').textContent = ad.title;\n  document.getElementById('adTitle').textContent = ad.title;\n  document.getElementById('adMeta').textContent = ad.city + ' \u00b7 ' + ad.date;\n  document.getElementById('adPrice').textContent = ad.price;\n  document.getElementById('adPhone').textContent = ad.phoneMasked;\n  document.getElementById('adDesc').textContent = ad.description;\n  window.__adPhoneFull = ad.phoneFull || '0300-1234521 (sample)';\n\n  // Split bilingual description on \"---\" separator (English part shown above, Roman Urdu summary below)\n  const descParts = (ad.description || '').split(/\\n?---\\n?/);\n  if(descParts.length > 1){\n    document.getElementById('adDesc').textContent = descParts[0].trim();\n    document.getElementById('adDescUrdu').textContent = descParts[1].trim();\n    document.getElementById('adUrduBox').style.display = 'block';\n  }\n\n  // Render structured table if AI extracted one (extra_fields.table = {headers:[], rows:[[]]})\n  const tbl = ad.extraFields && ad.extraFields.table;\n  if(tbl && Array.isArray(tbl.headers) && Array.isArray(tbl.rows) && tbl.rows.length){\n    const thead = '<thead><tr>' + tbl.headers.map(h => `<th>${escapeHtml(h)}</th>`).join('') + '</tr></thead>';\n    const tbody = '<tbody>' + tbl.rows.map(row => '<tr>' + row.map(c => `<td>${escapeHtml(c)}</td>`).join('') + '</tr>').join('') + '</tbody>';\n    document.getElementById('adTable').innerHTML = thead + tbody;\n    document.getElementById('adTableBox').style.display = 'block';\n  }\n\n  const imgBox = document.getElementById('adImgBox');\n  if(ad.images && ad.images.length > 0){\n    imgBox.innerHTML = `<img src=\"${escapeHtml(ad.images[0])}\" alt=\"${escapeHtml(ad.title)}\" style=\"width:100%;height:100%;object-fit:cover;cursor:pointer\" onclick=\"window.__adCurrentFullImg && window.open(window.__adCurrentFullImg,'_blank')\">`;\n    window.__adCurrentFullImg = ad.images[0];\n    const viewLink = document.createElement('div');\n    viewLink.style.cssText = 'text-align:center;margin-top:6px';\n    viewLink.innerHTML = `<a href=\"${escapeHtml(ad.images[0])}\" target=\"_blank\" rel=\"noopener\" download style=\"font-size:.8rem;color:var(--green-dark);font-weight:600;text-decoration:none\">\ud83d\udd0d Original Photo Poora Dekhein / Download Karein</a>`;\n    imgBox.insertAdjacentElement('afterend', viewLink);\n    if(ad.images.length > 1){\n      const thumbRow = document.createElement('div');\n      thumbRow.className = 'ad-thumb-row';\n      thumbRow.innerHTML = ad.images.map((src,i) =>\n        `<img src=\"${escapeHtml(src)}\" alt=\"Photo ${i+1}\" class=\"ad-thumb\" data-src=\"${escapeHtml(src)}\">`\n      ).join('');\n      thumbRow.querySelectorAll('.ad-thumb').forEach(img => {\n        img.addEventListener('click', () => {\n          const s = img.getAttribute('data-src');\n          document.querySelector('#adImgBox img').src = s;\n          window.__adCurrentFullImg = s;\n        });\n      });\n      viewLink.insertAdjacentElement('afterend', thumbRow);\n    }\n  }\n\n  if(ad.isSample){\n    document.querySelector('.ad-detail-body').insertAdjacentHTML('afterbegin',\n      '<p style=\"font-size:.72rem;color:var(--muted);margin:0 0 6px\">\u26a0\ufe0f Ye sample ad hai (koi ?id= nahi diya gaya)</p>');\n  }\n\n  loadToolnestWidget(ad.catKey);\n}\n\nconst TOOLNEST_INTROS = {\n  property: \"Property calculations chahiye? Ye free tool try karein:\",\n  jobs: \"Job apply karte waqt ye kaam aa sakta hai:\",\n  matrimonial: \"Rishta process ko asaan banane ke liye:\",\n  electronics: \"Photos ke liye ye free tool istemal karein:\",\n  services: \"Apni service business ke liye ye tool try karein:\",\n  visa: \"Visa documents taiyar karne mein madad ke liye:\",\n  auctions: \"Auction documents scan/organize karne ke liye:\",\n  admissions: \"Admission documents taiyar karne ke liye:\",\n  tenders: \"Tender documents scan/organize karne ke liye:\"\n};\n\nasync function loadToolnestWidget(catKey){\n  if(!catKey) return;\n  try{\n    const res = await fetch('toolnest-tools.json');\n    const map = await res.json();\n    const tools = map[catKey];\n    if(!tools || tools.length === 0) return;\n    const tool = tools[Math.floor(Math.random() * tools.length)];\n    const intro = TOOLNEST_INTROS[catKey] || \"Ye related free tool try karein:\";\n    const toolUrl = `https://toolnest.link/${tool.slug}.html`;\n    document.getElementById('toolnestWidget').innerHTML = `\n      <a class=\"toolnest-card\" href=\"${toolUrl}\" target=\"_blank\" rel=\"noopener\">\n        <div class=\"tn-card-icon\">\ud83e\uddf0</div>\n        <div class=\"tn-card-text\">\n          <p class=\"tn-label\">${intro}</p>\n          <p class=\"tn-tool-name\">${tool.name} <span class=\"tn-arrow\">\u2197</span></p>\n          <p class=\"tn-credit\">Powered by ToolNest \u2014 99 free tools</p>\n        </div>\n      </a>\n    `;\n  }catch(e){ /* widget is optional; fail silently */ }\n}\n\ndocument.getElementById('revealBtn').addEventListener('click', () => {\n  document.getElementById('adPhone').textContent = window.__adPhoneFull || '0300-1234521 (sample)';\n  document.getElementById('revealBtn').textContent = '\u2705 Number Revealed';\n  document.getElementById('revealBtn').disabled = true;\n});\n\ndocument.getElementById('reportBtn').addEventListener('click', async () => {\n  const params = new URLSearchParams(location.search);\n  const adId = params.get('id');\n  if(!adId){ alert('Sample ad ko report nahi kiya ja sakta.'); return; }\n  const { error } = await rzDb.from('ad_reports').insert([{ad_id: adId, reason: 'User reported via website'}]);\n  if(error){ alert('Report submit nahi ho saki: ' + error.message); return; }\n  alert('Report submit ho gayi \u2014 admin isay review karega.');\n});\n</script>\n</body>\n</html>\n";

function esc(str) {
  return String(str ?? '')
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

export default async function handler(req, res) {
  const id = (req.query.id || '').toString();
  const siteUrl = 'https://roznamaads.pk';
  const pageUrl = id ? `${siteUrl}/ad.html?id=${encodeURIComponent(id)}` : `${siteUrl}/ad.html`;

  let title = 'Ad Details \u2014 RoznamaAds.pk';
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
        title = `${ad.title} \u2014 RoznamaAds.pk`;
        description = `${catLabel}${ad.city ? ' \u00b7 ' + ad.city : ''}${ad.price ? ' \u00b7 ' + ad.price : ''} \u2014 RoznamaAds.pk par dekhein.`;
        if (ad.images && ad.images.length) image = ad.images[0];
      }
    } catch (e) {
      // Supabase fetch failed -- fall back to generic defaults set above
    }
  }

  const html = AD_HTML_TEMPLATE
    .replace(
      '<title id="pageTitle">Ad Details \u2014 RoznamaAds.pk</title>',
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
      '<meta property="og:title" id="ogTitle" content="Ad Details \u2014 RoznamaAds.pk">',
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
