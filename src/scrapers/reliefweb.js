import * as cheerio from 'cheerio';
import logger from '../utils/logger.js';
import { isJobPosting, classifyMecalCategory } from '../config/businessRules.js';
import { fetchHtml, fetchJson } from './utils.js';
import { enrichItemDates, parseLooseDate } from './dateExtract.js';

const API_BASE = 'https://api.reliefweb.int/v2/jobs';
const LIMIT = 50;

const CONSULTANCY_CAREER_FILTERS = ['Consultancies', 'Consultancy', 'Services and Consultancies'];

const CONSULTANCY_TEXT_HINTS = [
  'consultancy',
  'consultant',
  'consultance',
  'terms of reference',
  'termes de reference',
  'rfp',
  'rfq',
  'request for proposal',
  'request for quotation',
  'appel d offres',
  "appel d'offres",
  'prestation',
  'technical assistance',
  'assistance technique',
  'training',
  'formation',
  'inventory',
  'inventaire',
  'market study',
  'etude de marche'
];

function reliefWebAppName() {
  return (process.env.RELIEFWEB_APPNAME || 'mecal-monitor-maison-ecal-rdc').trim();
}

function mapReliefWebRow(row) {
  const f = row.fields || {};
  const title = f.name || '';
  const body = (f.body || '').replace(/<[^>]+>/g, ' ');
  const org = f.source?.[0]?.name || '';
  const href = f.url || f.uri || row.href || '';
  const deadline = f.date?.closing ? new Date(f.date.closing) : null;
  const posted = f.date?.created ? new Date(f.date.created) : null;
  const careerCategories = (f.career_categories || [])
    .map((item) => item?.name || item)
    .filter(Boolean)
    .join(' ');
  const themes = (f.theme || [])
    .map((item) => item?.name || item)
    .filter(Boolean)
    .join(' ');

  return {
    title,
    description: `${body}\n${careerCategories}\n${themes}`.trim(),
    organization: org,
    deadline,
    postedDate: posted,
    sourceUrl: href,
    platform: 'ReliefWeb',
    location: 'RDC — Democratic Republic of the Congo'
  };
}

function isConsultancyNotice(item) {
  const blob = `${item.title} ${item.description}`;
  if (isJobPosting(blob)) return false;
  return classifyMecalCategory(blob) !== null;
}

function logReliefWebAuthError(status) {
  if (status === 403) {
    logger.warn(
      `ReliefWeb API: appname "${reliefWebAppName()}" refusé (403). Demandez un appname sur https://apidoc.reliefweb.int/ puis définissez RELIEFWEB_APPNAME dans backend/.env`
    );
    return;
  }
  if (status === 410) {
    logger.warn('ReliefWeb API: endpoint v1 retiré — utilisez l’API v2 (mise à jour appliquée).');
  }
}

async function fetchReliefWebJobs(filters = []) {
  const params = new URLSearchParams();
  params.append('appname', reliefWebAppName());
  params.append('preset', 'latest');
  params.append('limit', String(LIMIT));
  for (const [field, value] of filters) {
    params.append('filter[field]', field);
    params.append('filter[value]', value);
  }

  const url = `${API_BASE}?${params.toString()}`;
  try {
    const data = await fetchJson(url);
    return (data?.data || []).map(mapReliefWebRow);
  } catch (e) {
    logReliefWebAuthError(e.response?.status);
    throw e;
  }
}

/**
 * ReliefWeb dédié consultances / prestations en RDC (pas postes salariés).
 */
export async function scrapeReliefWeb() {
  const seen = new Set();
  const merged = [];

  try {
    const baseFilters = [['country.name', 'Democratic Republic of the Congo']];

    for (const career of CONSULTANCY_CAREER_FILTERS) {
      try {
        const batch = await fetchReliefWebJobs([...baseFilters, ['career_categories.name', career]]);
        for (const item of batch) {
          if (!item.sourceUrl || seen.has(item.sourceUrl)) continue;
          if (!isConsultancyNotice(item)) continue;
          seen.add(item.sourceUrl);
          merged.push(item);
        }
      } catch (e) {
        logger.warn(`ReliefWeb career filter "${career}": ${e.message}`);
      }
    }

    if (merged.length === 0) {
      try {
        const fallback = await fetchReliefWebJobs(baseFilters);
        for (const item of fallback) {
          if (!item.sourceUrl || seen.has(item.sourceUrl)) continue;
          if (!isConsultancyNotice(item)) continue;
          seen.add(item.sourceUrl);
          merged.push(item);
        }
      } catch (e) {
        logger.warn(`ReliefWeb fallback DRC: ${e.message}`);
      }
    }

    const htmlJobs = await scrapeReliefWebJobsHtml();
    for (const item of htmlJobs) {
      if (!item.sourceUrl || seen.has(item.sourceUrl)) continue;
      seen.add(item.sourceUrl);
      merged.push(item);
    }

    const rssItems = await scrapeReliefWebRss();
    for (const item of rssItems) {
      if (!item.sourceUrl || seen.has(item.sourceUrl)) continue;
      seen.add(item.sourceUrl);
      merged.push(item);
    }

    logger.info(`ReliefWeb: ${merged.length} notices (jobs API + RSS RDC logistique)`);
    return merged;
  } catch (e) {
    logger.warn(`ReliefWeb API: ${e.message}`);
    return [];
  }
}

async function scrapeReliefWebJobsHtml() {
  const urls = [
    'https://reliefweb.int/jobs?advanced-search=%28C.COD%29&search=consultanc%20OR%20logistics%20OR%20%22supply%20chain%22',
    'https://reliefweb.int/jobs?advanced-search=%28C.COD%29'
  ];
  const items = [];
  const seen = new Set();
  for (const url of urls) {
    try {
      const html = await fetchHtml(url);
      const $ = cheerio.load(html);
      $('a[href*="/job/"]').each((_, el) => {
        const href = $(el).attr('href') || '';
        const title = $(el).text().replace(/\s+/g, ' ').trim();
        if (!title || title.length < 20) return;
        const sourceUrl = href.startsWith('http') ? href : `https://reliefweb.int${href}`;
        if (seen.has(sourceUrl)) return;
        seen.add(sourceUrl);
        const card = $(el).closest('article, li, .rw-river-article, .views-row');
        const extra = card.length ? card.text().replace(/\s+/g, ' ').trim() : title;
        items.push({
          title,
          description: extra,
          organization: 'ReliefWeb',
          sourceUrl,
          platform: 'ReliefWeb',
          location: 'RDC — Democratic Republic of the Congo',
          skipDateEnrich: true
        });
      });
    } catch (e) {
      logger.warn(`ReliefWeb jobs HTML: ${e.message}`);
    }
  }
  logger.info(`ReliefWeb jobs HTML: ${items.length} liens`);
  return items;
}

const DEFAULT_RSS =
  'https://reliefweb.int/updates/rss.xml?search=%22Democratic%20Republic%20of%20the%20Congo%22%20(logistics%20OR%20transport%20OR%20%22supply%20chain%22)';

async function scrapeReliefWebRss() {
  const url = (process.env.RELIEFWEB_RSS_URL || DEFAULT_RSS).trim();
  try {
    const xml = await fetchHtml(url);
    const $ = cheerio.load(xml, { xmlMode: true });
    const items = [];
    $('item').each((_, el) => {
      const title = $(el).find('title').first().text().replace(/\s+/g, ' ').trim();
      const link = $(el).find('link').first().text().trim() || $(el).find('guid').first().text().trim();
      const description = $(el)
        .find('description')
        .first()
        .text()
        .replace(/<[^>]+>/g, ' ')
        .replace(/\s+/g, ' ')
        .trim();
      const pubDate = $(el).find('pubDate').first().text().trim();
      if (!title || !link) return;
      items.push({
          title,
          description,
          organization: 'ReliefWeb',
          postedDate: parseLooseDate(pubDate),
          deadline: null,
          skipDateEnrich: true,
          sourceUrl: link,
          platform: 'ReliefWeb',
          location: 'RDC — Democratic Republic of the Congo'
        });
    });
    logger.info(`ReliefWeb RSS: ${items.length} items`);
    return items;
  } catch (e) {
    logger.warn(`ReliefWeb RSS: ${e.message}`);
    return [];
  }
}
