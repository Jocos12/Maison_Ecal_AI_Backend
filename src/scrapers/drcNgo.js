import { fetchHtml, loadCheerio } from './utils.js';
import logger from '../utils/logger.js';

/**
 * Danish Refugee Council lists vacancies in the HTML of drc.ngo/jobs.
 * Each card already carries the country and the region, so no browser is required.
 */
const LIST_URL = 'https://drc.ngo/jobs/';
const ORIGIN = 'https://drc.ngo';

const TITLE_OK =
  /\b(logistic|logistics|supply chain|procurement|purchasing|warehouse|warehousing|fleet|freight|transport|distribution|inventory|storekeeper|cadena de suministro|achats|approvisionnement)/i;
const CATEGORY_OK = /supply|logistic|procurement|fleet|warehouse/i;

const clean = (value) => String(value || '').replace(/\s+/g, ' ').trim();

export function drcJobUrl(href) {
  const path = String(href || '');
  if (!path) return LIST_URL;
  if (path.startsWith('http')) return path;
  return `${ORIGIN}${path.startsWith('/') ? path : `/${path}`}`;
}

export function drcJobId(href) {
  const match = /[?&]id=(\d+)/.exec(String(href || ''));
  return match ? match[1] : '';
}

export async function fetchDrcNgoJobs() {
  const html = await fetchHtml(LIST_URL);
  const $ = loadCheerio(html);
  const rows = [];
  $('.jobList__item').each((_, el) => {
    const title = clean($(el).attr('data-title'));
    const category = clean($(el).attr('data-category'));
    if (!TITLE_OK.test(title) && !CATEGORY_OK.test(category)) return;
    const href = $(el).find('a').attr('href') || '';
    const id = drcJobId(href);
    if (!id) return;
    rows.push({
      id,
      title,
      category,
      country: clean($(el).attr('data-country')),
      region: clean($(el).attr('data-region')),
      contract: clean($(el).attr('data-contract')),
      published: clean($(el).attr('data-published')),
      deadline: clean($(el).attr('data-deadline')),
      href
    });
  });
  return rows;
}

export async function fetchDrcNgoDetail(href) {
  try {
    const html = await fetchHtml(drcJobUrl(href));
    const $ = loadCheerio(html);
    const main = $('main').clone();
    main.find('script, style, nav, footer').remove();
    let text = clean(main.text());
    const cut = text.search(/DRC as an employer/i);
    if (cut > 400) text = text.slice(0, cut).trim();
    return { description: text.slice(0, 20000) };
  } catch (e) {
    logger.warn(`DRC: fiche illisible (${href}): ${e.message}`);
    return null;
  }
}
