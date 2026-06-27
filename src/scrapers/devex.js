import logger from '../utils/logger.js';
import { delay, launchBrowser, logScraperError } from './utils.js';

const FUNDING_URL =
  'https://www.devex.com/funding/r?filter[places][]=Democratic+Republic+of+Congo&filter[type][]=tender&filter[type][]=open_opportunity&filter[statuses][]=open';

export async function scrapeDevex() {
  let browser;
  try {
    browser = await launchBrowser();
    const page = await browser.newPage();
    await page.setUserAgent(
      process.env.USER_AGENT ||
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36'
    );
    await page.setViewport({ width: 1366, height: 900 });
    await page.goto('https://www.devex.com/', { waitUntil: 'domcontentloaded', timeout: 90000 });
    await delay(1500);
    await page.goto(FUNDING_URL, { waitUntil: 'networkidle2', timeout: 120000 });
    await delay(4000);

    for (let i = 0; i < 4; i++) {
      await page.evaluate(() => window.scrollBy(0, 1800));
      await delay(1500);
    }

    const snapshot = await page.evaluate(() => {
      const body = document.body?.innerText || '';
      const paywalled =
        /Devex Pro|Start my 5-day trial|no results matching your search/i.test(body) &&
        !document.querySelector('a[href*="report="]');
      const cards = [];
      const seen = new Set();

      const selectors = [
        'a[href*="report="]',
        'a[href*="/funding/"]',
        '[data-cy="funding-card"] a',
        'article a[href*="devex.com"]'
      ];

      for (const selector of selectors) {
        document.querySelectorAll(selector).forEach((anchor) => {
          const href = anchor.href || '';
          if (!href || seen.has(href)) return;
          const card = anchor.closest('article, li, [class*="card"], [class*="result"]') || anchor.parentElement;
          let title =
            card?.querySelector('h2, h3, h4, [class*="title"]')?.textContent?.trim() ||
            anchor.textContent?.trim() ||
            '';
          title = title.replace(/\s+/g, ' ').trim();
          if (!title || title.length < 8) return;
          if (/sign in|join devex|search tips/i.test(title)) return;
          seen.add(href);
          cards.push({
            title,
            href,
            blob: (card?.innerText || title).slice(0, 2000)
          });
        });
      }

      return { paywalled, cards, bodySnippet: body.slice(0, 400) };
    });

    await browser.close();
    browser = null;

    if (snapshot.paywalled || snapshot.cards.length === 0) {
      logger.warn(
        'DevEx: aucun tender public (accès Funding souvent réservé à Devex Pro). Définissez DEVEX_DISABLED=true pour désactiver cette source.'
      );
      return [];
    }

    return snapshot.cards.map((row) => ({
      title: row.title,
      description: row.blob,
      organization: '',
      deadline: null,
      postedDate: null,
      sourceUrl: row.href,
      platform: 'DevEx',
      location: 'DRC — Democratic Republic of the Congo'
    }));
  } catch (e) {
    logScraperError('DevEx', e);
    if (browser) await browser.close().catch(() => {});
    return [];
  }
}
