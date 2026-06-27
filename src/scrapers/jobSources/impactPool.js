/**
 * Impact Pool — emplois ONG/UN (scraping HTML page recherche RDC).
 */
import * as cheerio from 'cheerio';
import logger from '../../utils/logger.js';
import { LOGISTICS_JOB_KEYWORDS } from '../../config/jobBusinessRules.js';
import { includesAny, normalizeText } from '../../config/businessRules.js';
import {
  fetchHtmlForScrape,
  resolveScrapeUrl,
  withScrapeGuards
} from './jobSourceUtils.js';

const BASE = 'https://www.impactpool.org';
const SEARCH_BASE = `${BASE}/jobs`;
const LIMIT = 25;

function buildSearchUrl(query = '') {
  const keywords = [query, 'logistics', 'supply chain', 'Congo', 'DRC'].filter(Boolean).join(' ');
  const params = new URLSearchParams({
    keywords: keywords.trim(),
    location: 'Democratic Republic of the Congo'
  });
  return `${SEARCH_BASE}?${params.toString()}`;
}

function isRelevantJob(title = '', description = '') {
  const blob = normalizeText(`${title} ${description}`);
  if (includesAny(blob, LOGISTICS_JOB_KEYWORDS)) return true;
  return /congo|rdc|drc|kinshasa|lubumbashi|goma|bukavu|logist|supply|warehouse|transport|humanit|un |ngo/.test(
    blob
  );
}

function mapItem({ title, description, sourceUrl, location = 'RDC', postedDate = null }) {
  return {
    title,
    description: description || title,
    organization: 'Impact Pool',
    deadline: null,
    postedDate,
    sourceUrl,
    platform: 'Impact Pool',
    location,
    contractType: ''
  };
}

function parseListingHtml(html, baseUrl) {
  const $ = cheerio.load(html);
  const items = [];
  const seen = new Set();

  const selectors = [
    '.job-item a[href]',
    '.vacancy-item a[href]',
    '[class*="job-card"] a[href]',
    'article a[href*="/jobs/"]',
    'a[href*="/jobs/"]'
  ];

  for (const selector of selectors) {
    $(selector).each((_, el) => {
      const href = $(el).attr('href') || '';
      if (!href || href === '/jobs' || href.endsWith('/jobs')) return;
      const title = $(el).text().replace(/\s+/g, ' ').trim();
      if (!title || title.length < 8) return;
      const fullUrl = resolveScrapeUrl(BASE, href);
      if (seen.has(fullUrl)) return;
      seen.add(fullUrl);

      const card = $(el).closest('article, li, div, tr');
      const loc = card.find('.location, [class*="location"]').first().text().trim();
      const date = card.find('.date, time, [class*="date"]').first().text().trim();

      items.push(
        mapItem({
          title,
          description: card.text().replace(/\s+/g, ' ').trim().slice(0, 300),
          sourceUrl: fullUrl,
          location: loc || 'RDC',
          postedDate: date || null
        })
      );
    });
    if (items.length >= LIMIT) break;
  }

  if (!items.length) {
    $('h2, h3').each((_, el) => {
      const title = $(el).text().replace(/\s+/g, ' ').trim();
      const link = $(el).find('a[href]').attr('href') || $(el).next('a[href]').attr('href');
      if (!title || title.length < 10 || !link) return;
      const fullUrl = resolveScrapeUrl(BASE, link);
      if (seen.has(fullUrl)) return;
      seen.add(fullUrl);
      items.push(mapItem({ title, sourceUrl: fullUrl }));
    });
  }

  return items.slice(0, LIMIT);
}

function manualFallback(query = '') {
  return [
    mapItem({
      title: 'Voir les offres logistique sur Impact Pool',
      description: 'Lien de recherche manuel — plateforme internationale UN/ONG.',
      sourceUrl: buildSearchUrl(query),
      location: 'RDC / International'
    })
  ];
}

async function scrapeImpactPool({ query } = {}) {
  const searchUrl = buildSearchUrl(query);
  try {
    const html = await fetchHtmlForScrape(searchUrl, {
      sourceName: 'impact_pool',
      minCrawlDelayMs: 3000
    });
    const items = parseListingHtml(html, searchUrl).filter((j) =>
      isRelevantJob(j.title, j.description)
    );
    if (items.length) {
      logger.info(`[JobAssistant] Impact Pool: ${items.length}`);
      return { items, status: 'ok', error: null };
    }
  } catch (e) {
    logger.warn(`[JobAssistant] Impact Pool: ${e.message}`);
  }

  return { items: manualFallback(query), status: 'ok', error: null, manualFallback: true };
}

export async function searchImpactPool(params = {}) {
  const cacheKey = params.query ? `q:${params.query}` : '__drc_search__';
  return withScrapeGuards('impact_pool', cacheKey, () => scrapeImpactPool(params), {
    minCrawlDelayMs: 3000
  });
}
