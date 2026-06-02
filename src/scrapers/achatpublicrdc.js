import { fetchHtml, loadCheerio, absoluteUrl, safeText, logScraperError } from './utils.js';

const BASE = 'https://www.achatpublic.cd';

export async function scrapeAchatPublicRdc() {
  try {
    const html = await fetchHtml(`${BASE}/avis-de-marche`);
    const $ = loadCheerio(html);
    const items = [];
    $('table a, .list-group-item a, article a, tr td a').each((_, el) => {
      const href = $(el).attr('href');
      if (!href) return;
      const title = safeText($, el);
      if (title.length < 6) return;
      const row = $(el).closest('tr');
      const rowText = row.length ? safeText($, row) : '';
      items.push({
        title,
        description: rowText,
        organization: 'Achat Public RDC',
        deadline: null,
        postedDate: null,
        sourceUrl: absoluteUrl(BASE, href),
        platform: 'AchatPublicRDC',
        location: 'DRC'
      });
    });
    const unique = [];
    const seen = new Set();
    for (const it of items) {
      if (seen.has(it.sourceUrl)) continue;
      seen.add(it.sourceUrl);
      unique.push(it);
      if (unique.length >= 50) break;
    }
    return unique;
  } catch (e) {
    logScraperError('AchatPublicRDC', e);
    return [];
  }
}
