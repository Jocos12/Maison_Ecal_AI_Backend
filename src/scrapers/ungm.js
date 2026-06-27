import axios from 'axios';
import https from 'https';
import logger from '../utils/logger.js';
import { delay, loadCheerio, logScraperError } from './utils.js';

const UNGM_BASE = 'https://www.ungm.org';
const SEARCH_URL = `${UNGM_BASE}/Public/Notice/Search`;
const NOTICE_PAGE = `${UNGM_BASE}/Public/Notice?beneficiaryCountry=COD`;
const DRC_COUNTRY_ID = Number(process.env.UNGM_DRC_COUNTRY_ID || 2339);
const PAGE_SIZE = 15;

function createUngmClient() {
  const config = {
    headers: {
      'User-Agent':
        process.env.USER_AGENT ||
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36'
    }
  };
  if (process.env.SCRAPER_TLS_REJECT_UNAUTHORIZED === 'false') {
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
  const match = String(text || '').match(/(\d{1,2}-[A-Za-z]{3}-\d{4})/);
  if (!match) return null;
  const d = new Date(match[1]);
  return Number.isNaN(d.getTime()) ? null : d;
}

function parseSearchHtml(html) {
  const $ = loadCheerio(html);
  const items = [];
  $('[role="row"]').each((_, row) => {
    const title = $(row).find('.resultTitle .ungm-title').text().replace(/\s+/g, ' ').trim();
    const href = $(row).find('a[href*="/Public/Notice/"]').first().attr('href');
    if (!title || !href || !/\/Public\/Notice\/\d+/.test(href)) return;
    const deadlineText = $(row).find('.deadline').text().replace(/\s+/g, ' ').trim();
    const agency = $(row).find('.resultAgency').text().replace(/\s+/g, ' ').trim();
    items.push({
      title,
      description: `${title}\n${agency}\n${deadlineText}`.trim(),
      organization: agency || 'UNGM',
      deadline: parseDeadline(deadlineText),
      postedDate: null,
      sourceUrl: href.startsWith('http') ? href : `${UNGM_BASE}${href}`,
      platform: 'UNGM',
      location: 'RDC — Democratic Republic of the Congo'
    });
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
  const client = createUngmClient();

  try {
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
  } catch (e) {
    logScraperError('UNGM', e);
    return [];
  }
}
