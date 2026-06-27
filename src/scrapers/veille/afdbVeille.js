/**
 * African Development Bank — veille complémentaire projets RDC (infrastructure, transport, logistique).
 */
import logger from '../../utils/logger.js';
import { delay, launchBrowser, logScraperError } from '../utils.js';
import { filterAfdbVeilleItems } from '../../config/veilleSourceFilters.js';

const PROCUREMENT_URL = 'https://www.afdb.org/en/projects-and-operations/procurement';
const LIMIT = 60;

export async function scrapeAfdbVeille() {
  let browser;
  try {
    browser = await launchBrowser();
    const page = await browser.newPage();
    await page.setUserAgent(
      process.env.USER_AGENT ||
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36'
    );
    await page.setViewport({ width: 1366, height: 900 });
    await page.goto(PROCUREMENT_URL, { waitUntil: 'networkidle2', timeout: 120000 });
    await delay(2500);

    for (let i = 0; i < 3; i++) {
      await page.evaluate(() => window.scrollBy(0, 2000));
      await delay(1200);
    }

    const snapshot = await page.evaluate(() => {
      const items = [];
      const seen = new Set();
      document.querySelectorAll('a[href*="/documents/"]').forEach((anchor) => {
        const href = anchor.href || '';
        const title = anchor.textContent?.replace(/\s+/g, ' ').trim() || '';
        if (!title || title.length < 18 || seen.has(href)) return;
        if (!/afdb\.org\/(en|fr)\/documents\//i.test(href)) return;
        seen.add(href);
        items.push({ title, href, blob: title });
      });
      return items;
    });

    await browser.close();
    browser = null;

    const mapped = snapshot.map((row) => ({
      title: row.title,
      description: row.blob,
      organization: 'African Development Bank',
      deadline: null,
      postedDate: null,
      sourceUrl: row.href,
      platform: 'AfDB',
      location: ''
    }));

    const items = filterAfdbVeilleItems(mapped)
      .slice(0, LIMIT)
      .map((item) => ({
        ...item,
        location: 'RDC — Democratic Republic of the Congo'
      }));
    logger.info(`AfDBVeille: ${mapped.length} raw → ${items.length} après filtre RDC/infrastructure-transport-logistique`);
    return items;
  } catch (e) {
    logScraperError('AfDBVeille', e);
    if (browser) await browser.close().catch(() => {});
    return [];
  }
}
