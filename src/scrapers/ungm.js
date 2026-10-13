import axios from 'axios';
import https from 'https';
import logger from '../utils/logger.js';
import { delay, loadCheerio, logScraperError } from './utils.js';
import { enrichItemDates, parseLooseDate } from './dateExtract.js';

const UNGM_BASE = 'https://www.ungm.org';
const SEARCH_URL = `${UNGM_BASE}/Public/Notice/Search`;
const NOTICE_PAGE = `${UNGM_BASE}/Public/Notice?beneficiaryCountry=COD`;
const DRC_COUNTRY_ID = Number(process.env.UNGM_DRC_COUNTRY_ID || 2339);
const PAGE_SIZE = 15;

function createUngmClient({ insecure = false } = {}) {
  const config = {
    timeout: 45000,
    headers: {
      'User-Agent':
        process.env.USER_AGENT ||
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36'
    }
  };
  if (insecure || process.env.SCRAPER_TLS_REJECT_UNAUTHORIZED === 'false') {
    config.httpsAgent = new https.Agent({ rejectUnauthorized: false });
  }
  return axios.create(config);
}

function cookieHeaderFrom(setCookie = []) {
  return setCookie
    .map((line) => line.split(';')[0])
    .filter(Boolean)
    .join('; ');
}

function buildSearchPayload(pageIndex) {
  return {
    PageIndex: pageIndex,
    PageSize: PAGE_SIZE,
    Title: '',
    Description: '',
    Reference: '',
    PublishedFrom: '',
    PublishedTo: '',
    DeadlineFrom: '',
    DeadlineTo: '',
    Countries: [DRC_COUNTRY_ID],
    Agencies: [],
    UNSPSCs: [],
    NoticeTypes: [],
    SortField: 'Deadline',
    SortAscending: false,
    isPicker: false,
    IsSustainable: false,
    IsActive: true,
    NoticeDisplayType: null,
    NoticeSearchTotalLabelId: 'noticeSearchTotal',
    TypeOfCompetitions: []
  };
}

function parseDeadline(text) {
  return parseLooseDate(text);
}

function parseSearchHtml(html) {
  const $ = loadCheerio(html);
  const items = [];
  $('[role="row"]').each((_, row) => {
    const title = $(row).find('.resultTitle .ungm-title').text().replace(/\s+/g, ' ').trim();
    const href = $(row).find('a[href*="/Public/Notice/"]').first().attr('href');
    if (!title || !href || !/\/Public\/Notice\/\d+/.test(href)) return;
    const deadlineText = $(row)
      .find('.deadline, .resultDeadline, [class*="Deadline"]')
      .text()
      .replace(/\s+/g, ' ')
      .trim();
    const publishedText = $(row)
      .find('.published, .resultPublished, .resultDate, [class*="Published"]')
      .text()
      .replace(/\s+/g, ' ')
      .trim();
    const agency = $(row).find('.resultAgency').text().replace(/\s+/g, ' ').trim();
    const rowText = $(row).text().replace(/\s+/g, ' ').trim();
    const item = enrichItemDates({
      title,
      description: `${title}\n${agency}\n${publishedText}\n${deadlineText}\n${rowText}`.trim(),
      organization: agency || 'UNGM',
      deadline: parseDeadline(deadlineText),
      postedDate: parseLooseDate(publishedText),
      sourceUrl: href.startsWith('http') ? href : `${UNGM_BASE}${href}`,
      platform: 'UNGM',
      location: 'RDC — Democratic Republic of the Congo'
    });
    items.push(item);
  });
  return items;
}

async function fetchUngmPage(client, pageIndex, sessionCookie) {
  const { data } = await client.post(SEARCH_URL, buildSearchPayload(pageIndex), {
    headers: {
      Referer: NOTICE_PAGE,
      'X-Requested-With': 'XMLHttpRequest',
      Accept: 'application/json, text/javascript, */*; q=0.01',
      'Content-Type': 'application/json',
      ...(sessionCookie ? { Cookie: sessionCookie } : {})
    },
    timeout: 45000
  });
  return parseSearchHtml(String(data));
}

export async function scrapeUngm() {
  const limit = Number(process.env.UNGM_SCRAPE_LIMIT || 50);
  const maxPages = Math.max(1, Math.ceil(limit / PAGE_SIZE));

  const run = async (insecure) => {
    const client = createUngmClient({ insecure });
    const bootstrap = await client.get(NOTICE_PAGE);
    const sessionCookie = cookieHeaderFrom(bootstrap.headers['set-cookie']);
    await delay(500);

    const merged = [];
    const seen = new Set();

    for (let page = 1; page <= maxPages && merged.length < limit; page++) {
      const batch = await fetchUngmPage(client, page, sessionCookie);
      if (batch.length === 0) break;
      for (const item of batch) {
        if (seen.has(item.sourceUrl)) continue;
        seen.add(item.sourceUrl);
        merged.push(item);
        if (merged.length >= limit) break;
      }
      if (page < maxPages) await delay(400);
    }

    logger.info(`UNGM: ${merged.length} notices RDC (country id ${DRC_COUNTRY_ID})`);
    return merged;
  };

  try {
    return await run(false);
  } catch (e) {
    const certError = /certificate/i.test(e.message || '') || e.code === 'UNABLE_TO_VERIFY_LEAF_SIGNATURE';
    if (certError) {
      try {
        return await run(true);
      } catch (e2) {
        logScraperError('UNGM', e2);
        return [];
      }
    }
    logScraperError('UNGM', e);
    return [];
  }
}
