// Reusable Social Share Widget — RoznamaAds.pk
// Usage: <div id="myShareWidget"></div>
//        <script src="share-widget.js"></script>
//        <script>renderShareWidget('myShareWidget', { url: '...', title: '...' });</script>
// (For nested pages like /blog/xyz.html, pass a relative path to share-widget.js accordingly.)

function renderShareWidget(containerId, opts) {
  const container = document.getElementById(containerId);
  if (!container) return;
  opts = opts || {};
  const url = opts.url || window.location.href;
  const title = opts.title || document.title || '';

  const platforms = [
    { name: 'WhatsApp', color: '#25D366', href: `https://api.whatsapp.com/send?text=${encodeURIComponent(title + ' ' + url)}` },
    { name: 'Facebook', color: '#1877F2', href: `https://www.facebook.com/sharer/sharer.php?u=${encodeURIComponent(url)}` },
    { name: 'X (Twitter)', color: '#000000', href: `https://twitter.com/intent/tweet?text=${encodeURIComponent(title)}&url=${encodeURIComponent(url)}` },
    { name: 'LinkedIn', color: '#0A66C2', href: `https://www.linkedin.com/sharing/share-offsite/?url=${encodeURIComponent(url)}` }
  ];

  const toggleId = containerId + '-share-toggle';
  const menuId = containerId + '-share-menu';

  container.innerHTML = `
    <div class="share-widget">
      <button type="button" class="share-btn" id="${toggleId}">🔗 Share</button>
      <div class="share-menu" id="${menuId}" style="display:none">
        ${platforms.map(p => `
          <a href="${p.href}" target="_blank" rel="noopener">
            <span class="share-dot" style="background:${p.color}"></span>${p.name}
          </a>
        `).join('')}
      </div>
    </div>
  `;

  const toggleBtn = document.getElementById(toggleId);
  const menu = document.getElementById(menuId);

  toggleBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    menu.style.display = menu.style.display === 'none' ? 'block' : 'none';
  });

  // Bahar click karne pe menu band ho jaye
  document.addEventListener('click', (e) => {
    if (!container.contains(e.target)) menu.style.display = 'none';
  });
}
