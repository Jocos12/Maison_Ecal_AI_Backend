import logger from '../utils/logger.js';
import { fetchHtml, loadCheerio } from './utils.js';
import { htmlToText } from './nrc.js';

/**
 * ICRC publishes vacancies on careers.icrc.org, a SuccessFactors site.
 * Search results are in the HTML. The country code is on each job page, not in the list.
 */
const SEARCH = 'https://careers.icrc.org/search/';
const ORIGIN = 'https://careers.icrc.org';
const WORDS = ['logistics', 'supply chain', 'procurement', 'warehouse', 'fleet'];

const TITLE_OK =
  /\b(logistic|logistics|supply chain|procurement|purchasing|warehouse|warehousing|fleet|freight|transport|distribution|inventory|storekeeper|stores\b|achats|approvisionnement)/i;

const clean = (value) => String(value || '').replace(/\s+/g, ' ').trim();

export function icrcJobUrl(href) {
  const path = String(href || '');
  if (!path) return SEARCH;
  if (path.startsWith('http')) return path;
  return `${ORIGIN}${path.startsWith('/') ? path : `/${path}`}`;
}

export function icrcJobId(href) {
  const match = /\/(\d+)\/?$/.exec(String(href || ''));
  return match ? match[1] : '';
}

async function searchWord(word) {
  const found = [];
  for (let start = 0; start <= 50; start += 25) {
    const url = `${SEARCH}?q=${encodeURIComponent(word)}&startrow=${start}&locale=en_GB`;
    const html = await fetchHtml(url);
    const $ = loadCheerio(html);
    let added = 0;
    $('a[href*="/job/"]').each((_, el) => {
      const href = $(el).attr('href') || '';
      const title = clean($(el).text());
      const id = icrcJobId(href);
      if (!id || !title || !TITLE_OK.test(title)) return;
      found.push({ id, title, href });
      added += 1;
    });
    if (!added) break;
  }
  return found;
}

export async function fetchIcrcJobs() {
  const byId = new Map();
  for (const word of WORDS) {
    const rows = await searchWord(word);
    for (const row of rows) {
      if (!byId.has(row.id)) byId.set(row.id, row);
    }
  }
  return [...byId.values()];
}

/** "Mekele (MEK), ET, 33806" -> city plus the ISO country code. */
export function parseIcrcAddress(raw) {
  const parts = String(raw || '')
    .split(',')
    .map((part) => part.trim())
    .filter(Boolean);
  const countryCode = parts.find((part) => /^[A-Z]{2}$/.test(part)) || '';
  return { location: parts[0] || clean(raw), countryCode };
}

export async function fetchIcrcDetail(href) {
  try {
    const html = await fetchHtml(icrcJobUrl(href));
    const $ = loadCheerio(html);
    const address = $('meta[itemprop="streetAddress"]').attr('content') || '';
    const place = parseIcrcAddress(address);
    const block = $('.jobdescription, [itemprop="description"]').first();
    const description = htmlToText(block.html() || block.text() || '').slice(0, 20000);
    const deadline = $('meta[itemprop="validThrough"]').attr('content') || '';
    return { ...place, description, deadline, address };
  } catch (e) {
    logger.warn(`ICRC: fiche illisible (${href}): ${e.message}`);
    return null;
  }
}
