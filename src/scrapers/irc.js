import logger from '../utils/logger.js';
import { postJson } from './utils.js';
import { htmlToText } from './nrc.js';

/**
 * International Rescue Committee jobs live on Workday, linked from careers.rescue.org.
 * The public CXS API lists postings without a browser. Only logistics-related titles are kept.
 */
const JOBS_URL = 'https://theirc.wd1.myworkdayjobs.com/wday/cxs/theirc/External_Careers/jobs';
const JOB_PAGE = 'https://theirc.wd1.myworkdayjobs.com/en-US/External_Careers';
const SUPPLY_CHAIN_FAMILY = '3514013df82f100159a39067a3980000';

const TITLE_OK =
  /\b(logistic|logistics|supply chain|procurement|purchasing|warehouse|warehousing|fleet|freight|transport|distribution|inventory|storekeeper|stores\b|achats|approvisionnement)/i;

const clean = (value) => String(value || '').replace(/\s+/g, ' ').trim();

async function fetchPage({ searchText = '', facets = {}, offset = 0, limit = 20 }) {
  return postJson(JOBS_URL, {
    appliedFacets: facets,
    limit,
    offset,
    searchText
  });
}

async function fetchAll({ searchText = '', facets = {}, max = 60 }) {
  const out = [];
  let offset = 0;
  let total = Infinity;
  while (offset < total && out.length < max) {
    const data = await fetchPage({ searchText, facets, offset, limit: 20 });
    total = Number(data?.total || 0);
    const rows = data?.jobPostings || [];
    if (!rows.length) break;
    out.push(...rows);
    offset += rows.length;
    if (rows.length < 20) break;
  }
  return out;
}

export function requisitionId(row) {
  const fromBullet = Array.isArray(row.bulletFields) ? row.bulletFields.find((v) => /^JR\d+/i.test(String(v))) : '';
  if (fromBullet) return String(fromBullet);
  const path = String(row.externalPath || '');
  const m = /_(JR\d+)/i.exec(path);
  return m ? m[1] : path;
}

export function publicJobUrl(externalPath) {
  const path = String(externalPath || '');
  if (!path) return JOB_PAGE;
  if (path.startsWith('http')) return path;
  return `${JOB_PAGE}${path.startsWith('/') ? path : `/${path}`}`;
}

/** Supply-chain category plus keyword searches, then a title filter so "operations" noise stays out. */
export async function fetchIrcLogisticsJobs() {
  let supply = [];
  try {
    supply = await fetchAll({ facets: { jobFamilyGroup: [SUPPLY_CHAIN_FAMILY] }, max: 40 });
  } catch (e) {
    logger.warn(`IRC: facette supply chain ignorée (${e.message})`);
  }
  const keywordHits = [];
  for (const word of ['logistics', 'supply chain', 'procurement', 'warehouse', 'fleet']) {
    keywordHits.push(...(await fetchAll({ searchText: word, max: 20 })));
  }
  const byId = new Map();
  for (const row of supply) {
    const id = requisitionId(row);
    if (id && !byId.has(id)) byId.set(id, row);
  }
  for (const row of keywordHits) {
    const id = requisitionId(row);
    if (!id || !TITLE_OK.test(row.title || '')) continue;
    if (!byId.has(id)) byId.set(id, row);
  }
  return [...byId.values()];
}

export async function fetchIrcJobDetailGet(externalPath) {
  const path = String(externalPath || '').replace(/^\//, '');
  if (!path) return null;
  const { fetchJson } = await import('./utils.js');
  const url = `https://theirc.wd1.myworkdayjobs.com/wday/cxs/theirc/External_Careers/${path}`;
  try {
    const data = await fetchJson(url, { headers: { Accept: 'application/json' } });
    const info = data?.jobPostingInfo || data;
    if (!info?.title && !info?.jobDescription) return null;
    const country = clean(info.country?.descriptor || info.jobRequisitionLocation?.country?.descriptor);
    const countryCode = clean(info.jobRequisitionLocation?.country?.alpha2Code).toUpperCase();
    const additionalLocations = Array.isArray(info.additionalLocations) ? info.additionalLocations.map(clean).filter(Boolean) : [];
    return {
      title: clean(info.title),
      location: clean(info.location || info.jobRequisitionLocation?.descriptor),
      country,
      countryCode,
      additionalLocations,
      postedDate: info.startDate ? new Date(info.startDate) : null,
      description: htmlToText(info.jobDescription || ''),
      reference: clean(info.jobReqId),
      applyUrl: clean(info.externalUrl) || publicJobUrl(externalPath)
    };
  } catch (e) {
    logger.warn(`IRC: fiche illisible (${path}): ${e.message}`);
    return null;
  }
}
