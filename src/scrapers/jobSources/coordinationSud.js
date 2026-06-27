/**
 * Coordination Sud — offres emploi ONG (RSS + page listing).
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

const BASE = 'https://www.coordinationsud.org';
const LIST_URL = `${BASE}/offres-emploi/`;
const RSS_URL = `${BASE}/?post_type=job_listing&feed=rss2`;
const LIMIT = 25;

function isRelevantJob(title = '', description = '') {
  const blob = normalizeText(`${title} ${description}`);
  if (includesAny(blob, LOGISTICS_JOB_KEYWORDS)) return true;
  return /congo|rdc|drc|kinshasa|lubumbashi|goma|bukavu|kalemie|afrique|africa|humanit|ong|supply|logist|warehouse|transport/.test(
    blob
  );
}

function mapItem({ title, description, sourceUrl, postedDate, location = 'RDC / Afrique' }) {
  return {
    title,
    description: description || title,
    organization: 'Coordination Sud',
    deadline: null,
    postedDate: postedDate || null,
    sourceUrl,
    platform: 'Coordination Sud',
    location,
    contractType: ''
  };
}

function parseRss(xml) {
  const $ = cheerio.load(xml, { xmlMode: true });
  const items = [];
  $('item').each((_, el) => {
    const title = $(el).find('title').first().text().replace(/\s+/g, ' ').trim();
    const link = $(el).find('link').first().text().trim();
    const desc = $(el)
      .find('description')
      .first()
      .text()
      .replace(/<[^>]+>/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
    const pubDate = $(el).find('pubDate').first().text().trim();
    if (!title || title.length < 6) return;
    items.push(
      mapItem({
        title,
        description: desc,
        sourceUrl: link || LIST_URL,
        postedDate: pubDate
      })
    );
  });
  return items;
}

function parseListingHtml(html) {
  const $ = cheerio.load(html);
  const items = [];
  const seen = new Set();

  $('a[href]').each((_, el) => {
    const href = $(el).attr('href') || '';
    if (!/offre|emploi|job|poste|vacance/i.test(href)) return;
    const title = $(el).text().replace(/\s+/g, ' ').trim();
    if (!title || title.length < 8) return;
    const fullUrl = resolveScrapeUrl(BASE, href);
    if (seen.has(fullUrl)) return;
    seen.add(fullUrl);
    items.push(mapItem({ title, sourceUrl: fullUrl }));
  });

  return items.slice(0, LIMIT);
}

function manualFallback(query = '') {
  const q = encodeURIComponent(String(query || 'logistique congo').trim());
  return [
    mapItem({
      title: 'Voir les offres logistique sur Coordination Sud',
      description: 'Lien de recherche manuel — plateforme ONG françaises, Afrique centrale.',
      sourceUrl: `${LIST_URL}?s=${q}`,
      location: 'Afrique / RDC'
    })
  ];
}

async function scrapeCoordinationSud({ query } = {}) {
  try {
    const rssXml = await fetchHtmlForScrape(RSS_URL, {
      sourceName: 'coordination_sud',
      minCrawlDelayMs: 3000
    });
    let items = parseRss(rssXml).filter((j) => isRelevantJob(j.title, j.description));
    if (items.length) {
      logger.info(`[JobAssistant] Coordination Sud RSS: ${items.length}`);
      return { items: items.slice(0, LIMIT), status: 'ok', error: null };
    }
  } catch (e) {
    logger.warn(`[JobAssistant] Coordination Sud RSS: ${e.message}`);
  }

  try {
    const html = await fetchHtmlForScrape(LIST_URL, {
      sourceName: 'coordination_sud',
      minCrawlDelayMs: 3000
    });
    const items = parseListingHtml(html).filter((j) => isRelevantJob(j.title, j.description));
    if (items.length) {
      logger.info(`[JobAssistant] Coordination Sud HTML: ${items.length}`);
      return { items, status: 'ok', error: null };
    }
  } catch (e) {
    logger.warn(`[JobAssistant] Coordination Sud HTML: ${e.message}`);
  }

  return { items: manualFallback(query), status: 'ok', error: null, manualFallback: true };
}

export async function searchCoordinationSud(params = {}) {
  const cacheKey = params.query ? `q:${params.query}` : '__listing__';
  return withScrapeGuards('coordination_sud', cacheKey, () => scrapeCoordinationSud(params), {
    minCrawlDelayMs: 3000
  });
}
