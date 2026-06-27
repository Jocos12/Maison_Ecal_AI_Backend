import axios from 'axios';
import https from 'https';
import puppeteer from 'puppeteer';
import * as cheerio from 'cheerio';
import logger from '../utils/logger.js';

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

export async function fetchHtml(url, { timeout = 25000, headers = {} } = {}) {
  const { data } = await axios.get(url, axiosConfig({ timeout, headers }));
  return data;
}

export async function fetchJson(url, { timeout = 30000, headers = {} } = {}) {
  const { data } = await axios.get(
    url,
    axiosConfig({
      timeout,
      headers: { Accept: 'application/json', ...headers }
    })
  );
  return data;
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
  const base = { headless: 'new', args };
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
    const title = safeText($, el);
    if (title.length < 15) return;
    items.push({
      title,
      description: title,
      organization: 'ARMP RDC',
      deadline: null,
      postedDate: null,
      sourceUrl: absoluteUrl(ARMP_BASE, href),
      platform,
      location: 'RDC — République Démocratique du Congo'
    });
  });
  return items;
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

  return unique;
}
