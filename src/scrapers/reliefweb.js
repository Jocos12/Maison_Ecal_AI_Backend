import axios from 'axios';
import logger from '../utils/logger.js';

const BASE =
  'https://api.reliefweb.int/v1/jobs?appname=mecal&preset=latest&limit=50';

/**
 * ReliefWeb "jobs" includes humanitarian roles and consultancies — we filter downstream.
 */
export async function scrapeReliefWeb() {
  const url = `${BASE}&filter[field]=country.name&filter[value]=${encodeURIComponent(
    'Democratic Republic of the Congo'
  )}`;
  try {
    const { data } = await axios.get(url, {
      timeout: 30000,
      headers: { Accept: 'application/json', 'User-Agent': process.env.USER_AGENT || 'M-ECAL-Bot/1.0' }
    });
    const items = data?.data || [];
    return items.map((row) => {
      const f = row.fields || {};
      const title = f.name || '';
      const body = (f.body || '').replace(/<[^>]+>/g, ' ');
      const org = f.source?.[0]?.name || '';
      const href = f.url || f.uri || row.href || '';
      const deadline = f.date?.closing ? new Date(f.date.closing) : null;
      const posted = f.date?.created ? new Date(f.date.created) : null;
      return {
        title,
        description: body,
        organization: org,
        deadline,
        postedDate: posted,
        sourceUrl: href,
        platform: 'ReliefWeb',
        location: 'DRC'
      };
    });
  } catch (e) {
    logger.warn(`ReliefWeb API: ${e.message}`);
    return [];
  }
}
