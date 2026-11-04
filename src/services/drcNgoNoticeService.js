import NrcNotice from '../models/NrcNotice.js';
import SystemSetting from '../models/SystemSetting.js';
import logger from '../utils/logger.js';
import { countryNameFrom, isDrcNotice } from './nrcCountries.js';
import { classifyWorkplaces } from './africaWorkplace.js';
import { scoreNotice } from './nrcService.js';
import { drcJobUrl, fetchDrcNgoDetail, fetchDrcNgoJobs } from '../scrapers/drcNgo.js';

const SYNC_KEY = 'drcngo_sync';
const MAX_DETAILS = Math.max(1, Number(process.env.DRCNGO_MAX_DETAILS || 12));

let inFlight = null;

function parseWhen(value) {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

function placeOf(row) {
  const workplace = classifyWorkplaces({ country: row.country, location: row.country });
  const regionalAfrica = row.region === 'Africa';
  const outsideRegion = Boolean(row.region) && row.region !== 'Africa';
  let locationScope = workplace.locationScope;
  if (outsideRegion) locationScope = 'outside';
  else if (regionalAfrica) locationScope = 'africa';
  const countryCode = workplace.countryCode || '';
  return {
    country: countryCode ? countryNameFrom(countryCode, row.country) : row.country,
    countryCode,
    location: row.country,
    locationScope,
    isDrc: isDrcNotice({
      countryCode,
      country: row.country,
      location: row.country,
      title: row.title
    })
  };
}

async function patchSync(patch) {
  const $set = {};
  for (const [key, value] of Object.entries(patch)) $set[`value.${key}`] = value;
  await SystemSetting.findOneAndUpdate({ key: SYNC_KEY }, { $set }, { upsert: true });
}

export function isDrcNgoSyncRunning() {
  return Boolean(inFlight);
}

export async function getDrcNgoSyncState() {
  const doc = await SystemSetting.findOne({ key: SYNC_KEY }).lean();
  return { ...(doc?.value || {}), running: isDrcNgoSyncRunning() };
}

async function runDrcNgoSync({ refreshDetails = false } = {}) {
  const cap = refreshDetails ? Math.max(MAX_DETAILS, 40) : MAX_DETAILS;
  await patchSync({ running: true, startedAt: new Date(), error: '' });
  const rows = await fetchDrcNgoJobs();
  rows.sort((a, b) => Number(b.region === 'Africa') - Number(a.region === 'Africa'));
  const now = new Date();
  let detailed = 0;
  const seen = [];
  for (const row of rows) {
    const externalId = `drcngo:${row.id}`;
    const existing = await NrcNotice.findOne({ externalId }).select('detailFetchedAt description').lean();
    let detail = null;
    const wantsDetail = row.region === 'Africa' && (refreshDetails || !existing?.detailFetchedAt) && detailed < cap;
    if (wantsDetail) {
      detail = await fetchDrcNgoDetail(row.href);
      if (detail) detailed += 1;
    }
    const description = detail?.description || existing?.description || '';
    const place = placeOf(row);
    const category = /supply|logistic|procurement/i.test(row.category) ? row.category : '';
    const scored = await scoreNotice(
      {
        kind: 'job',
        title: row.title,
        description,
        location: place.location,
        country: place.country,
        jobInfo: { category }
      },
      { useAi: false }
    );
    if (!scored.isLogistics) continue;
    const deadline = parseWhen(row.deadline);
    const postedDate = parseWhen(row.published);
    const applyUrl = drcJobUrl(row.href);
    await NrcNotice.updateOne(
      { externalId },
      {
        $set: {
          kind: 'job',
          organization: 'drcngo',
          title: row.title,
          url: applyUrl,
          applyUrl,
          reference: row.id,
          noticeType: row.contract || '',
          country: place.country,
          countryCode: place.countryCode,
          location: place.location,
          locationScope: place.locationScope,
          isDrc: place.isDrc,
          description,
          deadline: deadline || undefined,
          sortDeadline: deadline ? deadline.getTime() : 9e15,
          postedDate: postedDate || undefined,
          jobInfo: { category },
          lastSeenAt: now,
          isArchived: false,
          archivedReason: '',
          ...scored
        },
        $setOnInsert: { externalId, firstSeenAt: now, isNew: true }
      },
      { upsert: true }
    );
    seen.push({ pipeline: 'notice', platform: 'DrcNgo', externalId });
  }
  await patchSync({ running: false, lastRunAt: new Date(), found: seen.length, detailed, error: '' });
  logger.info(`DRC: ${seen.length} poste(s) logistique, ${detailed} fiche(s), ${rows.filter((row) => row.region === 'Africa').length} en Afrique`);
  return seen;
}

export function syncDrcNgoNotices(options = {}) {
  if (inFlight) return inFlight;
  inFlight = runDrcNgoSync(options)
    .catch(async (e) => {
      logger.warn(`DRC: ${e.message}`);
      await patchSync({ running: false, lastRunAt: new Date(), error: String(e.message || '').slice(0, 400) }).catch(() => {});
      throw e;
    })
    .finally(() => {
      inFlight = null;
    });
  return inFlight;
}

export async function scrapeDrcNgo() {
  return syncDrcNgoNotices();
}
