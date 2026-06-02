import puppeteer from 'puppeteer';
import { delay, logScraperError } from './utils.js';

const LIST_URL =
  'https://www.ungm.org/Public/Notice?deadline=&beneficiaryCountry=COD';

export async function scrapeUngm() {
  let browser;
  try {
    browser = await puppeteer.launch({
      headless: 'new',
      args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage']
    });
    const page = await browser.newPage();
    await page.setUserAgent(
      process.env.USER_AGENT ||
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
    );
    await page.goto(LIST_URL, { waitUntil: 'networkidle2', timeout: 90000 });
    await delay(3000);
    const rows = await page.evaluate(() => {
      const out = [];
      const trs = document.querySelectorAll('table tbody tr, .tableWrapperDiv tr, [class*="table"] tr');
      trs.forEach((tr) => {
        const link = tr.querySelector('a[href*="/Public/Notice/"]');
        const tds = tr.querySelectorAll('td');
        if (!link || tds.length < 2) return;
        const title = (link.textContent || '').trim();
        const href = link.getAttribute('href') || '';
        const cells = Array.from(tds).map((td) => (td.textContent || '').trim());
        out.push({
          title,
          href: href.startsWith('http') ? href : `https://www.ungm.org${href}`,
          rowText: cells.join(' | ')
        });
      });
      return out;
    });
    await browser.close();
    browser = null;
    return rows.map((r) => {
      let deadline = null;
      const dm = r.rowText.match(/(\d{1,2}[./-]\d{1,2}[./-]\d{2,4})/);
      if (dm) {
        const d = new Date(dm[1].replace(/\./g, '/'));
        if (!Number.isNaN(d.getTime())) deadline = d;
      }
      return {
        title: r.title,
        description: r.rowText,
        organization: '',
        deadline,
        postedDate: null,
        sourceUrl: r.href,
        platform: 'UNGM',
        location: 'DRC'
      };
    });
  } catch (e) {
    logScraperError('UNGM', e);
    if (browser) await browser.close().catch(() => {});
    return [];
  }
}
