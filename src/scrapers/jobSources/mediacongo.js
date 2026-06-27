/**
 * MediaCongo.net — offres d'emploi certifiées RDC (scraping HTML).
 * robots.txt : Crawl-delay 10s, pas de Disallow global.
 */
import * as cheerio from 'cheerio';
import logger from '../../utils/logger.js';
import {
  checkRobotsAllowed,
  fetchHtmlForScrape,
  getJobScraperUserAgent,
  resolveScrapeUrl,
  withScrapeGuards
} from './jobSourceUtils.js';

const BASE = 'https://www.mediacongo.net';
const LIST_URL = `${BASE}/emplois.html`;
const CRAWL_DELAY_MS = 10000;
const LIMIT = 40;

function slugToTitle(slug = '') {
  return slug
    .replace(/_/g, ' ')
    .replace(/\b\w/g, (c) => c.toUpperCase())
    .trim();
}

function parseListingPage(html) {
  const $ = cheerio.load(html);
  const items = [];
  const seen = new Set();

  $('a[href*="emploi-societe-"]').each((_, el) => {
    const href = $(el).attr('href') || '';
    const linkText = $(el).text().replace(/\s+/g, ' ').trim();
    const fullUrl = resolveScrapeUrl(BASE, href);
    if (seen.has(fullUrl)) return;
    seen.add(fullUrl);

    const slugMatch = href.match(/emploi-societe-\d+_(.+)\.html/i);
    const slugTitle = slugMatch ? slugToTitle(slugMatch[1]) : '';
    const title = linkText.length > 8 ? linkText : slugTitle;
    if (!title || title.length < 6) return;

    items.push({
      title,
      description: title,
      organization: 'MediaCongo',
      deadline: null,
      postedDate: null,
      sourceUrl: fullUrl,
      platform: 'MediaCongo',
      location: 'RDC',
      contractType: ''
    });
  });

  return items.slice(0, LIMIT);
}

async function scrapeMediaCongo() {
  const robots = await checkRobotsAllowed(LIST_URL, { userAgent: getJobScraperUserAgent() });
  if (!robots.allowed) {
    return {
      items: [],
      status: 'error',
      error: 'robots_txt_disallow',
      message: 'MediaCongo interdit le scraping de cette URL (robots.txt)'
    };
  }

  const html = await fetchHtmlForScrape(LIST_URL, {
    sourceName: 'mediacongo',
    minCrawlDelayMs: Math.max(CRAWL_DELAY_MS, robots.crawlDelayMs || 0)
  });
  const items = parseListingPage(html);
  logger.info(`[JobAssistant] MediaCongo: ${items.length} raw`);
  return { items, status: 'ok', error: null };
}

export async function searchMediaCongo() {
  const cacheKey = '__listing__';
  return withScrapeGuards('mediacongo', cacheKey, () => scrapeMediaCongo(), {
    minCrawlDelayMs: CRAWL_DELAY_MS
  });
}
