import { fetchHtml, loadCheerio, absoluteUrl, safeText, logScraperError } from './utils.js';

const BASE = 'https://www.profilrdc.com';

export async function scrapeProfilRdc() {
  try {
    const html = await fetchHtml(`${BASE}/offres-de-service/`);
    const $ = loadCheerio(html);
    const items = [];
    $('article a, .entry-title a, h2 a, .post-title a').each((_, el) => {
      const href = $(el).attr('href');
      if (!href || href === '#') return;
      const title = safeText($, el);
      if (title.length < 8) return;
      items.push({
        title,
        sourceUrl: absoluteUrl(BASE, href),
        description: '',
        organization: 'ProfilRDC',
        deadline: null,
        postedDate: null,
        platform: 'ProfilRDC',
        location: ''
      });
    });
    const unique = [];
    const seen = new Set();
    for (const it of items) {
      if (seen.has(it.sourceUrl)) continue;
      seen.add(it.sourceUrl);
      unique.push(it);
      if (unique.length >= 40) break;
    }
    return unique;
  } catch (e) {
    logScraperError('ProfilRDC', e);
    return [];
  }
}
