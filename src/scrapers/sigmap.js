import { delay, launchBrowser, loadCheerio, logScraperError, safeText } from './utils.js';
import { enrichItemDates, parseLooseDate } from './dateExtract.js';
import logger from '../utils/logger.js';

const SIGMAP_URL = 'https://marchepublic.cd/portail/index.xhtml';

function parseListingHtml(html) {
  const $ = loadCheerio(html);
  const items = [];
  const seen = new Set();

  const pushItem = ({ title, href, organization, extra, deadlineText }) => {
    if (!title || title.length < 18 || !href) return;
    if (/^(accueil|connexion|inscription|publications|liste noire)$/i.test(title)) return;
    if (/plans de passation des march/i.test(title)) return;
    if (/index\.xhtml/i.test(href) && title.length < 40) return;
    let sourceUrl = href;
    try {
      sourceUrl = new URL(href, 'https://marchepublic.cd/').href;
    } catch {
      return;
    }
    if (seen.has(sourceUrl)) return;
    seen.add(sourceUrl);
    items.push(
      enrichItemDates({
        title,
        description: `${title}\n${organization || ''}\n${extra || ''}`.trim(),
        organization: organization || 'SIGMAP',
        deadline: parseLooseDate(deadlineText || extra || ''),
        sourceUrl,
        platform: 'SIGMAP',
        location: 'RDC — Democratic Republic of the Congo'
      })
    );
  };

  $('a[href]').each((_, el) => {
    const href = $(el).attr('href') || '';
    if (!/xhtml|detail|avis|publication|aao|ami/i.test(href)) return;
    if (/login|signUp|blackList|privacy|terms/i.test(href)) return;
    const title = safeText($, el);
    if (title.length < 24) return;
    const $row = $(el).closest('tr, li, .ui-datatable-row, article');
    const extra = $row.length ? safeText($, $row) : title;
    pushItem({ title, href, extra, deadlineText: extra });
  });

  $('table tbody tr, .ui-datatable-data tr').each((_, tr) => {
    const $tr = $(tr);
    const cells = $tr.find('td');
    if (!cells.length) return;
    const title =
      safeText($, $tr.find('a').first()) ||
      safeText($, cells.eq(0)) ||
      safeText($, cells.eq(1));
    const href = $tr.find('a[href]').first().attr('href') || '';
    const extra = safeText($, $tr);
    pushItem({
      title,
      href,
      organization: cells.length > 2 ? safeText($, cells.eq(1)) : 'SIGMAP',
      extra,
      deadlineText: extra
    });
  });

  return items;
}

async function clickMenuByText(page, pattern) {
  const clicked = await page.evaluate((reSource) => {
    const re = new RegExp(reSource, 'i');
    const links = [...document.querySelectorAll('a, span, button')];
    const el = links.find((node) => re.test((node.textContent || '').replace(/\s+/g, ' ').trim()));
    if (!el) return false;
    el.click();
    return true;
  }, pattern);
  if (clicked) await delay(3500);
  return clicked;
}

async function collectFromPage(page) {
  await delay(1500);
  const html = await page.content();
  return parseListingHtml(html);
}

export async function scrapeSigmap() {
  let browser;
  try {
    browser = await launchBrowser();
    const page = await browser.newPage();
    await page.setUserAgent(
      process.env.USER_AGENT ||
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36'
    );
    await page.goto(SIGMAP_URL, { waitUntil: 'networkidle2', timeout: 90000 });
    await page.waitForSelector('table, .ui-datatable, form', { timeout: 20000 }).catch(() => {});
    await delay(2500);

    const merged = [];
    const seen = new Set();
    const add = (batch) => {
      for (const item of batch) {
        if (seen.has(item.sourceUrl)) continue;
        seen.add(item.sourceUrl);
        merged.push(item);
      }
    };

    add(await collectFromPage(page));
    await clickMenuByText(page, "avis d['’']appel d['’']offres");
    await delay(4000);
    add(await collectFromPage(page));
    for (let i = 0; i < 4; i += 1) {
      const next = await page.evaluate(() => {
        const btn = [...document.querySelectorAll('a, button, span')].find((node) =>
          /suivant|next|ui-paginator-next/i.test(
            `${node.textContent || ''} ${node.className || ''} ${node.getAttribute('aria-label') || ''}`
          )
        );
        if (!btn || /ui-state-disabled/.test(btn.className || '')) return false;
        btn.click();
        return true;
      });
      if (!next) break;
      await delay(2500);
      add(await collectFromPage(page));
    }
    await page.evaluate(() => {
      const search = document.querySelector('#searchForm\\:j_idt103, button[type="submit"], .ui-button');
      if (search) search.click();
    });
    await delay(3000);
    add(await collectFromPage(page));
    await clickMenuByText(page, 'manifestation');
    add(await collectFromPage(page));

    logger.info(`SIGMAP: ${merged.length} avis extraits`);
    return merged;
  } catch (e) {
    logScraperError('SIGMAP', e);
    return [];
  } finally {
    if (browser) await browser.close().catch(() => {});
  }
}
