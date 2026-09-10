// Zero-dependency lightweight HTML parser for table extraction + link scanning.
// Deliberately NOT a full HTML5 parser — handles the real-world patterns needed
// for data tables (nesting, rowspan/colspan, thead) without adding an npm
// dependency (which is what crashed the Vercel function previously).

const ENTITY_MAP = {
  amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ',
  hellip: '…', mdash: '—', ndash: '–', rsquo: '’', lsquo: '‘',
  rdquo: '”', ldquo: '“', copy: '©', reg: '®', trade: '™'
};

export function decodeEntities(str) {
  if (!str) return '';
  return str.replace(/&(#x?[0-9a-fA-F]+|[a-zA-Z]+);/g, (m, code) => {
    if (code[0] === '#') {
      const isHex = code[1] === 'x' || code[1] === 'X';
      const num = parseInt(code.slice(isHex ? 2 : 1), isHex ? 16 : 10);
      if (Number.isNaN(num)) return m;
      try { return String.fromCodePoint(num); } catch { return m; }
    }
    return ENTITY_MAP[code] ?? m;
  });
}

function stripTagsToText(html) {
  if (!html) return '';
  const noScripts = html.replace(/<(script|style)[^>]*>[\s\S]*?<\/\1>/gi, ' ');
  const withBreaks = noScripts.replace(/<(br|\/p|\/div|\/li|\/tr)\b[^>]*>/gi, ' ');
  const noTags = withBreaks.replace(/<!--[\s\S]*?-->/g, ' ').replace(/<[^>]+>/g, '');
  return decodeEntities(noTags).replace(/\s+/g, ' ').trim();
}

// Finds every element span for a given tag name, correctly handling nesting
// (needed for <table> since tables can contain tables).
function findElementSpans(html, tagName) {
  const openRe = new RegExp(`<${tagName}\\b[^>]*>`, 'gi');
  const closeRe = new RegExp(`<\\/${tagName}\\s*>`, 'gi');
  const events = [];
  let m;
  openRe.lastIndex = 0;
  while ((m = openRe.exec(html))) events.push({ type: 'open', index: m.index, endOfTag: m.index + m[0].length, raw: m[0] });
  closeRe.lastIndex = 0;
  while ((m = closeRe.exec(html))) events.push({ type: 'close', index: m.index, endOfTag: m.index + m[0].length });
  events.sort((a, b) => a.index - b.index);

  const stack = [];
  const spans = [];
  for (const ev of events) {
    if (ev.type === 'open') {
      stack.push(ev);
    } else if (stack.length) {
      const open = stack.pop();
      spans.push({
        start: open.index,
        end: ev.endOfTag,
        openTagEnd: open.endOfTag,
        innerStart: open.endOfTag,
        innerEnd: ev.index,
        openTagRaw: open.raw
      });
    }
  }
  return spans.sort((a, b) => a.start - b.start);
}

function maskSpans(html, spans) {
  // Replace nested-element regions with spaces of the same length so outer
  // indices stay valid and we don't accidentally parse nested rows/cells twice.
  if (!spans.length) return html;
  const chars = html.split('');
  for (const s of spans) {
    for (let i = s.start; i < s.end; i++) chars[i] = ' ';
  }
  return chars.join('');
}

function getAttr(tagRaw, attrName) {
  const re = new RegExp(`${attrName}\\s*=\\s*("([^"]*)"|'([^']*)'|([^\\s>]+))`, 'i');
  const m = tagRaw.match(re);
  if (!m) return null;
  return m[2] !== undefined ? m[2] : (m[3] !== undefined ? m[3] : m[4]);
}

function firstLinkInCell(html) {
  const m = html.match(/<a\b[^>]*href\s*=\s*("([^"]*)"|'([^']*)')[^>]*>/i);
  if (!m) return null;
  return m[2] !== undefined ? m[2] : m[3];
}

// ---------------------------------------------------------------------------
// Public: extract all <table> elements (including nested) as row/col grids,
// with rowspan/colspan expansion — mirrors what cheerio-based code did.
// ---------------------------------------------------------------------------

export function extractTableGrids(html) {
  const cleanedHtml = html.replace(/<(script|style)[^>]*>[\s\S]*?<\/\1>/gi, ' ');
  const tableSpans = findElementSpans(cleanedHtml, 'table');

  return tableSpans.map(tableSpan => {
    let inner = cleanedHtml.slice(tableSpan.innerStart, tableSpan.innerEnd);

    // Mask out any nested tables so their rows aren't attributed to this table.
    const nestedTables = findElementSpans(inner, 'table');
    inner = maskSpans(inner, nestedTables);

    // Track thead boundaries (relative to `inner`) to flag header rows.
    const theadSpans = findElementSpans(inner, 'thead');

    const rowSpans = findElementSpans(inner, 'tr');
    const grid = [];
    const pending = []; // colspan/rowspan carry-over

    rowSpans.forEach((rowSpan, rIdx) => {
      const rowInner = inner.slice(rowSpan.innerStart, rowSpan.innerEnd);
      const inThead = theadSpans.some(t => rowSpan.start >= t.start && rowSpan.end <= t.end);

      grid[rIdx] = grid[rIdx] || [];
      let col = 0;
      const advancePending = () => {
        while (pending[col] && pending[col].remainingRows > 0) {
          grid[rIdx][col] = pending[col].value;
          col++;
        }
      };
      advancePending();

      const cellSpans = [...findElementSpans(rowInner, 'td'), ...findElementSpans(rowInner, 'th')]
        .sort((a, b) => a.start - b.start);

      for (const cellSpan of cellSpans) {
        advancePending();
        const cellInnerHtml = rowInner.slice(cellSpan.innerStart, cellSpan.innerEnd);
        const isHeader = /^<th\b/i.test(cellSpan.openTagRaw) || inThead;
        const colspan = parseInt(getAttr(cellSpan.openTagRaw, 'colspan') || '1', 10) || 1;
        const rowspan = parseInt(getAttr(cellSpan.openTagRaw, 'rowspan') || '1', 10) || 1;
        const text = stripTagsToText(cellInnerHtml);
        const linkHref = firstLinkInCell(cellInnerHtml);

        for (let c = 0; c < colspan; c++) {
          const value = { text, isHeader, linkHref };
          grid[rIdx][col] = value;
          if (rowspan > 1) pending[col] = { remainingRows: rowspan - 1, value };
          col++;
          advancePending();
        }
      }

      for (let c = 0; c < pending.length; c++) {
        if (pending[c]) pending[c].remainingRows--;
      }
    });

    return grid;
  });
}

// ---------------------------------------------------------------------------
// Public: extract "list-style" data as table-shaped grids, for sites that
// present rows as <ul>/<ol><li> lists or repeated heading+"Label: Value" card
// blocks instead of a real <table>. Generic — not tied to any one website.
// Returns grids in the SAME shape as extractTableGrids() (array of rows of
// {text, isHeader, linkHref}) so callers can score/consume them identically.
// ---------------------------------------------------------------------------

export function extractListGrids(html) {
  const cleaned = html.replace(/<(script|style)[^>]*>[\s\S]*?<\/\1>/gi, ' ');
  const grids = [];

  // ---- Pattern A: bullet/numbered lists (<ul>/<ol> -> <li>) ----
  const chromeSpans = [
    ...findElementSpans(cleaned, 'nav'),
    ...findElementSpans(cleaned, 'header'),
    ...findElementSpans(cleaned, 'footer')
  ];
  const insideChrome = (pos) => chromeSpans.some(s => pos >= s.start && pos < s.end);

  const listSpans = [...findElementSpans(cleaned, 'ul'), ...findElementSpans(cleaned, 'ol')];
  for (const listSpan of listSpans) {
    if (insideChrome(listSpan.start)) continue;
    const inner = cleaned.slice(listSpan.innerStart, listSpan.innerEnd);
    // Mask nested lists so their <li> aren't double-counted as this list's rows.
    const nestedLists = [...findElementSpans(inner, 'ul'), ...findElementSpans(inner, 'ol')];
    const maskedInner = maskSpans(inner, nestedLists);
    const liSpans = findElementSpans(maskedInner, 'li');
    if (liSpans.length < 5) continue;

    const items = liSpans
      .map(li => {
        const liHtml = inner.slice(li.innerStart, li.innerEnd);
        return { text: stripTagsToText(liHtml), link: firstLinkInCell(liHtml) };
      })
      .filter(it => it.text);
    if (items.length < 5) continue;

    // Skip lists that look like short nav/menu labels rather than data rows.
    const meaningful = items.filter(it => it.text.length >= 3).length;
    if (meaningful / items.length < 0.7) continue;

    const grid = [[
      { text: 'List Item', isHeader: true, linkHref: null },
      { text: 'Detail / Link', isHeader: true, linkHref: null }
    ]];
    items.forEach(it => {
      let col1 = it.text, col2 = it.link || '';
      const commaIdx = it.text.indexOf(',');
      if (commaIdx > 0 && commaIdx < it.text.length - 1) {
        col1 = it.text.slice(0, commaIdx).trim();
        col2 = it.text.slice(commaIdx + 1).trim() || (it.link || '');
      }
      grid.push([
        { text: col1, isHeader: false, linkHref: it.link },
        { text: col2, isHeader: false, linkHref: null }
      ]);
    });
    grids.push(grid);
  }

  // NOTE: an earlier "heading + Label:Value card" pattern (Pattern B) was
  // tried and dropped — free-text label:value regexes produced wrong column
  // splits when a value itself contained a capitalized word (e.g. "GT Road"
  // misread as a new label). Rather than ship unreliable columns, card-style
  // pages fall through to "no structured data detected" until a real
  // structural signal (e.g. <strong> label tags) can be added reliably.

  return grids;
}

// ---------------------------------------------------------------------------
// Public: extract every <a href="..."> on the page with its text + rel attr.
// ---------------------------------------------------------------------------

export function extractLinks(html) {
  const cleaned = html.replace(/<(script|style)[^>]*>[\s\S]*?<\/\1>/gi, ' ');
  const anchorRe = /<a\b([^>]*)>([\s\S]*?)<\/a>/gi;
  const links = [];
  let m;
  while ((m = anchorRe.exec(cleaned))) {
    const attrs = m[1];
    const href = getAttr(attrs, 'href');
    if (!href) continue;
    const rel = (getAttr(attrs, 'rel') || '').toLowerCase();
    const text = stripTagsToText(m[2]);
    links.push({ href, text, rel });
  }
  return links;
}
