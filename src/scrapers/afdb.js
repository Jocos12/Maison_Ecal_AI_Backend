/**
 * BAD — avis d’acquisition (RSS + notices), filtrés RDC.
 */
import * as cheerio from 'cheerio';
import logger from '../utils/logger.js';
import { delay, fetchHtml, launchBrowser, logScraperError } from './utils.js';
import { enrichItemDates, parseLooseDate } from './dateExtract.js';

const RSS_URL = 'https://www.afdb.org/en/projects-and-operations/procurement.xml';
const NOTICES_URLS = [
  'https://www.afdb.org/en/documents/project-related-procurement/procurement-notices',
  'https://www.afdb.org/fr/documents/project-related-procurement/procurement-notices'
];
const LIMIT = 50;

function isDrcNotice(title = '', href = '') {
  const blob = `${title} ${href}`;
  return /(?:^|[\s\-–_,])rdc(?:$|[\s\-–_,])|\bdrc\b|democratic republic of (?:the )?congo|republique democratique du congo|république démocratique du congo|congo-kinshasa|kinshasa|goma|bukavu|lubumbashi/i.test(
    blob
  );
}

function mapItem({ title, href, extra = '' }) {
  if (!title || title.length < 18 || !href) return null;
  let sourceUrl = href;
  try {
    sourceUrl = new URL(href, 'https://www.afdb.org/').href;
  } catch {
    return null;
  }
  return enrichItemDates({
    title,
    description: `${title}\n${extra}`.trim(),
    organization: 'African Development Bank',
    postedDate: parseLooseDate(extra),
    sourceUrl,
    platform: 'AfDB',
    location: 'RDC — Democratic Republic of the Congo'
  });
}

function collectFromHtml(html, seen) {
  const $ = cheerio.load(html);
  const items = [];
  $('a[href*="/documents/"]').each((_, el) => {
    const title = $(el).text().replace(/\s+/g, ' ').trim();
    const href = $(el).attr('href') || '';
    if (!isDrcNotice(title, href)) return;
    const mapped = mapItem({ title, href });
    if (!mapped || seen.has(mapped.sourceUrl)) return;
    seen.add(mapped.sourceUrl);
    items.push(mapped);
  });
  return items;
}

async function scrapeRss() {
  try {
    const xml = await fetchHtml(RSS_URL);
    const $ = cheerio.load(xml, { xmlMode: true });
    const items = [];
    $('item').each((_, el) => {
      const title = $(el).find('title').first().text().replace(/\s+/g, ' ').trim();
      const link = $(el).find('link').first().text().trim();
      const desc = $(el).find('description').first().text().replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
      if (!isDrcNotice(title, `${link} ${desc}`)) return;
      const mapped = mapItem({ title, href: link, extra: desc });
      if (mapped) items.push(mapped);
    });
    logger.info(`AfDB RSS: ${items.length} avis RDC`);
    return items;
  } catch (e) {
    logger.warn(`AfDB RSS: ${e.message}`);
    return [];
  }
}

async function scrapeNoticesHtml() {
  const seen = new Set();
  const items = [];
  for (const url of NOTICES_URLS) {
    try {
      const html = await fetchHtml(url);
      items.push(...collectFromHtml(html, seen));
    } catch (e) {
      logger.warn(`AfDB notices axios ${url}: ${e.message}`);
    }
  }
  if (items.length) {
    logger.info(`AfDB notices HTML: ${items.length} avis RDC`);
    return items;
  }

  let browser;
  try {
    browser = await launchBrowser();
    const page = await browser.newPage();
    await page.setUserAgent(
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36'
    );
    for (const url of NOTICES_URLS) {
      await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 60000 });
      await delay(2500);
      const html = await page.content();
      items.push(...collectFromHtml(html, seen));
    }
    logger.info(`AfDB notices Puppeteer: ${items.length} avis RDC`);
  } catch (e) {
    logger.warn(`AfDB notices Puppeteer: ${e.message}`);
  } finally {
    if (browser) await browser.close().catch(() => {});
  }
  return items;
}

export async function scrapeAfdb() {
  try {
    const merged = [];
    const seen = new Set();
    for (const batch of [await scrapeRss(), await scrapeNoticesHtml()]) {
      for (const item of batch) {
        if (seen.has(item.sourceUrl)) continue;
        seen.add(item.sourceUrl);
        merged.push(item);
        if (merged.length >= LIMIT) break;
      }
    }
    logger.info(`AfDB: ${merged.length} avis RDC`);
    return merged;
  } catch (e) {
    logScraperError('AfDB', e);
    return [];
  }
}
