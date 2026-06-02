import puppeteer from 'puppeteer';
import { delay, logScraperError } from './utils.js';

const URL = 'https://www.devex.com/jobs/search?country_codes[]=CD';

export async function scrapeDevex() {
  let browser;
  try {
    browser = await puppeteer.launch({
      headless: 'new',
      args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage']
    });
    const page = await browser.newPage();
    await page.setUserAgent(process.env.USER_AGENT || 'Mozilla/5.0 (compatible; M-ECAL-Bot/1.0)');
    await page.goto(URL, { waitUntil: 'networkidle2', timeout: 120000 });
    for (let i = 0; i < 5; i++) {
      await page.evaluate(() => window.scrollBy(0, 2000));
      await delay(3000);
    }
    const items = await page.evaluate(() => {
      const cards = document.querySelectorAll('article a[href*="/jobs/"], [data-cy="job-card"] a');
      const seen = new Set();
      const out = [];
      cards.forEach((a) => {
        const href = a.href;
        if (!href || seen.has(href)) return;
        seen.add(href);
        const card = a.closest('article') || a.parentElement;
        const title = (a.textContent || card?.querySelector('h2, h3')?.textContent || '').trim();
        if (!title || title.length < 5) return;
        const org =
          card?.querySelector('[class*="organization"], [class*="company"]')?.textContent?.trim() || '';
        out.push({ title, href, org, blob: (card?.innerText || '').slice(0, 2000) });
      });
      return out;
    });
    await browser.close();
    browser = null;
    return items.map((r) => ({
      title: r.title,
      description: r.blob,
      organization: r.org,
      deadline: null,
      postedDate: null,
      sourceUrl: r.href,
      platform: 'DevEx',
      location: 'DRC'
    }));
  } catch (e) {
    logScraperError('DevEx', e);
    if (browser) await browser.close().catch(() => {});
    return [];
  }
}
