import axios from 'axios';
import * as cheerio from 'cheerio';
import logger from '../utils/logger.js';

const UA = process.env.USER_AGENT || 'M-ECAL-Bot/1.0';

export async function fetchHtml(url, { timeout = 25000 } = {}) {
  const { data } = await axios.get(url, {
    timeout,
    headers: { 'User-Agent': UA, Accept: 'text/html,application/xhtml+xml' },
    maxRedirects: 5
  });
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
