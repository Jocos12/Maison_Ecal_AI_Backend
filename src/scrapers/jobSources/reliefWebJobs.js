/**
 * ReliefWeb JOBS — module Assistant Emploi uniquement (pas la veille consultances).
 */
import logger from '../../utils/logger.js';
import { fetchJson } from '../utils.js';

const API_BASE = 'https://api.reliefweb.int/v2/jobs';
const LIMIT = 40;
const RDC_COUNTRY = 'Democratic Republic of the Congo';

function reliefWebAppName() {
  return (process.env.RELIEFWEB_APPNAME || '').trim();
}

export function isReliefWebConfigured() {
  return Boolean(reliefWebAppName());
}

function mapJobRow(row) {
  const f = row.fields || {};
  const careerCategories = (f.career_categories || [])
    .map((item) => item?.name || item)
    .filter(Boolean)
    .join(' ');
  const jobTypes = (f.job_type || [])
    .map((item) => item?.name || item)
    .filter(Boolean)
    .join(' ');
  const cities = (f.city || [])
    .map((item) => item?.name || item)
    .filter(Boolean)
    .join(', ');
  const body = (f.body || '').replace(/<[^>]+>/g, ' ').slice(0, 3000);

  return {
    title: f.name || '',
    description: `${body}\n${careerCategories}\n${jobTypes}`.trim(),
    organization: f.source?.[0]?.name || '',
    deadline: f.date?.closing ? new Date(f.date.closing) : null,
    postedDate: f.date?.created ? new Date(f.date.created) : null,
    sourceUrl: f.url || f.uri || row.href || '',
    platform: 'ReliefWeb',
    location: cities ? `RDC — ${cities}` : `RDC — ${RDC_COUNTRY}`,
    contractType: jobTypes || careerCategories || ''
  };
}

async function fetchJobs(filters = []) {
  const appname = reliefWebAppName();
  if (!appname) {
    throw Object.assign(new Error('RELIEFWEB_APPNAME non configuré'), { code: 'not_configured' });
  }

  const params = new URLSearchParams();
  params.append('appname', appname);
  params.append('preset', 'latest');
  params.append('limit', String(LIMIT));
  for (const [field, value] of filters) {
    params.append('filter[field]', field);
    params.append('filter[value]', value);
  }
  const data = await fetchJson(`${API_BASE}?${params.toString()}`);
  return (data?.data || []).map(mapJobRow);
}

export async function searchReliefWebJobs({ city } = {}) {
  if (!isReliefWebConfigured()) {
    logger.info('[JobAssistant] ReliefWeb désactivé — RELIEFWEB_APPNAME vide');
    return {
      items: [],
      status: 'disabled',
      error: 'not_configured',
      message: 'ReliefWeb désactivé — configurez RELIEFWEB_APPNAME dans backend/.env'
    };
  }

  try {
    const baseFilters = [['country.name', RDC_COUNTRY]];
    if (city) {
      baseFilters.push(['city', city]);
    }
    const items = await fetchJobs(baseFilters);
    logger.info(`[JobAssistant] ReliefWeb jobs: ${items.length} raw`);
    return { items, status: 'ok', error: null };
  } catch (e) {
    const code = e.code === 'not_configured' ? 'not_configured' : e.response?.status || 'unknown';
    if (code === 403) {
      logger.warn(
        `[JobAssistant] ReliefWeb jobs 403 — configurez RELIEFWEB_APPNAME dans backend/.env`
      );
    } else if (code !== 'not_configured') {
      logger.warn(`[JobAssistant] ReliefWeb jobs: ${e.message}`);
    }
    return {
      items: [],
      status: code === 'not_configured' ? 'disabled' : 'error',
      error: String(code),
      message: e.message
    };
  }
}
