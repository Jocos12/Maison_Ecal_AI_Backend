import axios from 'axios';
import https from 'https';
import puppeteer from 'puppeteer';
import * as cheerio from 'cheerio';
import logger from '../utils/logger.js';
import { enrichItemDates, extractDatesFromHtml, extractDatesFromText, parseLooseDate } from './dateExtract.js';
import { extractDeadlineFromArmpAttachments } from './pdfDeadline.js';
import { mapLimit } from './concurrency.js';

const UA = process.env.USER_AGENT || 'M-ECAL-Bot/1.0';

function axiosConfig(extra = {}) {
  const config = {
    timeout: 25000,
    headers: { 'User-Agent': UA, Accept: 'text/html,application/xhtml+xml,application/json' },
    maxRedirects: 5,
    ...extra
  };
  if (extra.headers) {
    config.headers = { 'User-Agent': UA, Accept: 'text/html,application/xhtml+xml,application/json', ...extra.headers };
  }
  if (process.env.SCRAPER_TLS_REJECT_UNAUTHORIZED === 'false') {
    config.httpsAgent = new https.Agent({ rejectUnauthorized: false });
  }
  return config;
}

export async function fetchBuffer(url, { timeout = 45000, headers = {} } = {}) {
  const extra = {
    timeout,
    responseType: 'arraybuffer',
    headers: { Accept: 'application/pdf,image/*,*/*', ...headers }
  };
  try {
    const { data, headers: resHeaders } = await axios.get(url, axiosConfig(extra));
    return { buffer: Buffer.from(data), contentType: resHeaders['content-type'] || '' };
  } catch (err) {
    const certError =
      err.code === 'UNABLE_TO_VERIFY_LEAF_SIGNATURE' ||
      err.code === 'CERT_HAS_EXPIRED' ||
      /certificate/i.test(err.message || '');
    if (!certError) throw err;
    const { data, headers: resHeaders } = await axios.get(
      url,
      axiosConfig({
        ...extra,
        httpsAgent: new https.Agent({ rejectUnauthorized: false })
      })
    );
    return { buffer: Buffer.from(data), contentType: resHeaders['content-type'] || '' };
  }
}

export async function fetchHtml(url, { timeout = 25000, headers = {} } = {}) {
  try {
    const { data } = await axios.get(url, axiosConfig({ timeout, headers }));
    return data;
  } catch (err) {
    const certError =
      err.code === 'UNABLE_TO_VERIFY_LEAF_SIGNATURE' ||
      err.code === 'CERT_HAS_EXPIRED' ||
      /certificate/i.test(err.message || '');
    if (!certError) throw err;
    const { data } = await axios.get(
      url,
      axiosConfig({
        timeout,
        headers,
        httpsAgent: new https.Agent({ rejectUnauthorized: false })
      })
    );
    return data;
  }
}

export async function fetchJson(url, { timeout = 30000, headers = {} } = {}) {
  try {
    const { data } = await axios.get(
      url,
      axiosConfig({
        timeout,
        headers: { Accept: 'application/json', ...headers }
      })
    );
    return data;
  } catch (err) {
    const certError =
      err.code === 'UNABLE_TO_VERIFY_LEAF_SIGNATURE' ||
      err.code === 'CERT_HAS_EXPIRED' ||
      /certificate/i.test(err.message || '');
    if (!certError) throw err;
    const { data } = await axios.get(
      url,
      axiosConfig({
        timeout,
        headers: { Accept: 'application/json', ...headers },
        httpsAgent: new https.Agent({ rejectUnauthorized: false })
      })
    );
    return data;
  }
}

export async function postJson(url, body, { timeout = 30000, headers = {} } = {}) {
  const { data } = await axios.post(url, body, axiosConfig({ timeout, headers }));
  return data;
}

export function loadCheerio(html) {
  return cheerio.load(html);
}

export async function delay(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

export function absoluteUrl(base, href) {
  try {
    return new URL(href, base).href;
  } catch {
    return href;
  }
}

export function safeText($, el) {
  try {
    return $(el).text().replace(/\s+/g, ' ').trim();
  } catch {
    return '';
  }
}

export function logScraperError(name, err) {
  logger.warn(`[${name}] ${err.message}`);
}

export async function launchBrowser() {
  const args = ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage'];
  const executablePath = process.env.PUPPETEER_EXECUTABLE_PATH?.trim();
  const base = { headless: 'new', args, ignoreHTTPSErrors: true };
  if (executablePath) return puppeteer.launch({ ...base, executablePath });
  try {
    return await puppeteer.launch({ ...base, channel: 'chrome' });
  } catch {
    return puppeteer.launch(base);
  }
}

const ARMP_BASE = 'https://marche.armp-rdc.cd';

function parseArmpPage(html, platform) {
  const $ = loadCheerio(html);
  const items = [];
  $('a[href*="/poste/"]').each((_, el) => {
    const href = $(el).attr('href');
    if (!href) return;
    const $a = $(el);
    const title =
      $a.find('.job-listing-loop-job__title, h3, h2').first().text().replace(/\s+/g, ' ').trim() ||
      safeText($, el);
    if (title.length < 15) return;
    const org = $a.find('.job-listing-company strong, .company strong').first().text().replace(/\s+/g, ' ').trim();
    const timeEl = $a.find('time').first();
    const postedDate =
      parseLooseFromAttr(timeEl.attr('datetime')) || parseLooseDate(timeEl.text()) || null;
    const cardText = $a.text().replace(/\s+/g, ' ').trim();
    const dates = extractDatesFromText(`${title}\n${cardText}`);
    const listingHasDeadline = /date\s*(de\s*)?(cl[oô]ture|limite)|deadline|cl[oô]ture/i.test(cardText);
    items.push({
      title,
      description: cardText.slice(0, 2000) || title,
      organization: org || 'ARMP RDC',
      deadline: listingHasDeadline ? dates.deadline : null,
      postedDate: postedDate || dates.postedDate,
      sourceUrl: absoluteUrl(ARMP_BASE, href),
      platform,
      location: 'RDC — République Démocratique du Congo'
    });
  });
  return items;
}

function parseLooseFromAttr(value) {
  if (!value) return null;
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? null : d;
}

async function enrichArmpDetailDates(items, { maxDetail = 50 } = {}) {
  const slice = items.slice(0, maxDetail);
  const rest = items.slice(maxDetail);
  const pageConcurrency = Math.max(1, Math.min(4, Number(process.env.ARMP_DETAIL_CONCURRENCY || 3)));

  await mapLimit(slice, pageConcurrency, async (item) => {
    try {
      const html = await fetchHtml(item.sourceUrl);
      const dates = extractDatesFromHtml(html);
      if (!item.deadline && dates.deadline) item.deadline = dates.deadline;
      if (!item.postedDate && dates.postedDate) item.postedDate = dates.postedDate;
      if (!item.deadline) {
        const fromFile = await extractDeadlineFromArmpAttachments(html, item.sourceUrl, {
          postedDate: item.postedDate
        });
        if (fromFile.deadline) {
          item.deadline = fromFile.deadline;
          item.deadlineSource = fromFile.source;
        }
      }
    } catch {
      /* listing dates already applied when available */
    }
  });

  return [...slice, ...rest].map((item) => enrichItemDates(item));
}

/**
 * Liste les avis publiés sur le portail ARMP (SIGMAP), avec pagination WordPress.
 */
export async function scrapeArmpCategory(categorySlug, { platform, limit = 50, maxPages } = {}) {
  const pageCap = maxPages ?? Math.max(1, Math.ceil(limit / 10));
  const unique = [];
  const seen = new Set();

  for (let page = 1; page <= pageCap && unique.length < limit; page++) {
    const path =
      page === 1
        ? `/categorie-poste/${categorySlug}`
        : `/categorie-poste/${categorySlug}/page/${page}`;
    const html = await fetchHtml(`${ARMP_BASE}${path}`);
    const batch = parseArmpPage(html, platform);
    if (batch.length === 0) break;
    for (const it of batch) {
      if (seen.has(it.sourceUrl)) continue;
      seen.add(it.sourceUrl);
      unique.push(it);
      if (unique.length >= limit) break;
    }
  }

  return enrichArmpDetailDates(unique, { maxDetail: unique.length });
}
