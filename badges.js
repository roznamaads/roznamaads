// Escape user-supplied text before inserting into innerHTML (XSS fix)
function escapeHtml(str){
  if(str === null || str === undefined) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

// Shared badge helpers — Visa & Auction special badges (Batch: badges)
function rzDaysLeft(dateStr){
  if(!dateStr) return null;
  const target = new Date(dateStr);
  if(isNaN(target)) return null;
  const today = new Date();
  today.setHours(0,0,0,0);
  target.setHours(0,0,0,0);
  return Math.round((target - today) / 86400000);
}

// Returns badge HTML (or '') for a given category + extra_fields object
function rzBadgesHtml(category, extraFields, size){
  extraFields = extraFields || {};
  const cls = size === 'lg' ? 'badge' : 'badge';
  let html = '';

  if(category === 'visa'){
    html += `<span class="${cls} badge-visa">🛂 Visa</span>`;
  }

  if(category === 'auctions'){
    html += `<span class="${cls} badge-auction">🔨 Auction</span>`;
    const days = rzDaysLeft(extraFields.auctionDate);
    if(days !== null){
      if(days < 0) html += `<span class="${cls} badge-deadline expired">Auction guzar gaya</span>`;
      else if(days === 0) html += `<span class="${cls} badge-deadline soon">Aaj Auction</span>`;
      else if(days <= 3) html += `<span class="${cls} badge-deadline soon">${days} din baaki</span>`;
      else html += `<span class="${cls} badge-deadline">${days} din baaki</span>`;
    }
  }

  // Tenders / Notices also carry a submission deadline field
  if((category === 'tenders' || category === 'notices') && extraFields.deadline){
    const days = rzDaysLeft(extraFields.deadline);
    if(days !== null){
      if(days < 0) html += `<span class="${cls} badge-deadline expired">Deadline guzar gaya</span>`;
      else if(days <= 3) html += `<span class="${cls} badge-deadline soon">${days} din baaki</span>`;
      else html += `<span class="${cls} badge-deadline">${days} din baaki</span>`;
    }
  }

  return html;
}
