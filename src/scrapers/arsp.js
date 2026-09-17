import { fetchHtml, loadCheerio, logScraperError, safeText } from './utils.js';
import { enrichItemDates, parseLooseDate } from './dateExtract.js';
import logger from '../utils/logger.js';

const ARSP_URL = 'https://appeldoffre.arsp.cd/';

function isExpiredState(text) {
  return /expir/i.test(String(text || ''));
}

export function parseArspHtml(html) {
  const $ = loadCheerio(html);
  const items = [];
  const seen = new Set();

  $('#Ao-DataTable tbody tr').each((_, tr) => {
    const $tr = $(tr);
    const cells = $tr.find('td');
    if (cells.length < 5) return;

    const title = safeText($, cells.eq(0));
    const organization = safeText($, cells.eq(1));
    const province = safeText($, cells.eq(2));
    const deadlineText = safeText($, cells.eq(3));
    const state = safeText($, cells.eq(4));
    const href = $tr.find('a[href*="/detail/"]').first().attr('href') || '';

    if (!title || title.length < 12 || !href) return;
    if (isExpiredState(state)) return;

    const sourceUrl = href.startsWith('http') ? href : new URL(href, ARSP_URL).href;
    if (seen.has(sourceUrl)) return;
    seen.add(sourceUrl);

    items.push(
      enrichItemDates({
        title,
        description: `${title}\n${organization}\n${province}\nDate d'expiration: ${deadlineText}\nÉtat: ${state}`,
        organization: organization || 'ARSP',
        deadline: parseLooseDate(deadlineText),
        sourceUrl,
        platform: 'ARSP',
        location: province ? `RDC — ${province}` : 'RDC — Democratic Republic of the Congo'
      })
    );
  });

  return items;
}

export async function scrapeArsp() {
  try {
    const html = await fetchHtml(ARSP_URL);
    const items = parseArspHtml(html);
    logger.info(`ARSP: ${items.length} avis en cours`);
    return items;
  } catch (e) {
    logScraperError('ARSP', e);
    return [];
  }
}
