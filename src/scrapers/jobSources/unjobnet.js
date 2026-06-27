/**
 * UNjobnet — agrégateur ONU/ONG (remplace unjobs.org dont le scraping est bloqué).
 * robots.txt : User-agent: * Disallow: (vide) — crawl autorisé.
 */
import * as cheerio from 'cheerio';
import logger from '../../utils/logger.js';
import {
  fetchHtmlForScrape,
  resolveScrapeUrl,
  withScrapeGuards
} from './jobSourceUtils.js';

const BASE = 'https://www.unjobnet.org';
const DRC_LISTING_URL = `${BASE}/countries/Democratic%20Republic%20of%20the%20Congo`;
const LIMIT = 40;

function extractOrganization(context = '', title = '') {
  let rest = context.replace(title, '').trim();
  const postedIdx = rest.search(/\bPosted\b/i);
  if (postedIdx > 0) rest = rest.slice(0, postedIdx).trim();
  rest = rest.replace(/Democratic Republic of the Congo.*$/i, '').trim();
  rest = rest.replace(/Dem\. Rep\. of Congo.*$/i, '').trim();
  return rest || 'UN / ONG';
}

function parseListingPage(html) {
  const $ = cheerio.load(html);
  const items = [];
  const seen = new Set();

  $('a[href*="/jobs/detail/"]').each((_, el) => {
    const href = $(el).attr('href') || '';
    const title = $(el).text().replace(/\s+/g, ' ').trim();
    if (!title || title.length < 12) return;

    const fullUrl = resolveScrapeUrl(BASE, href);
    if (seen.has(fullUrl)) return;
    seen.add(fullUrl);

    const parent = $(el).closest('article, li, tr, div');
    const context = parent.text().replace(/\s+/g, ' ').trim();

    items.push({
      title,
      description: context || title,
      organization: extractOrganization(context, title),
      deadline: null,
      postedDate: null,
      sourceUrl: fullUrl,
      platform: 'UNjobnet',
      location: 'RDC',
      contractType: ''
    });
  });

  return items.slice(0, LIMIT);
}

async function scrapeUnjobnet() {
  const html = await fetchHtmlForScrape(DRC_LISTING_URL, {
    sourceName: 'unjobnet',
    minCrawlDelayMs: 2000
  });
  const items = parseListingPage(html);
  logger.info(`[JobAssistant] UNjobnet: ${items.length} raw`);
  return { items, status: 'ok', error: null };
}

export async function searchUnjobnet() {
  return withScrapeGuards('unjobnet', '__drc_listing__', () => scrapeUnjobnet(), {
    minCrawlDelayMs: 2000
  });
}

/** @deprecated Alias — unjobs.org bloque le scraping ; utiliser UNjobnet */
export const searchUnjobs = searchUnjobnet;
