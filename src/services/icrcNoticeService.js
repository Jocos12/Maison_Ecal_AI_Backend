import NrcNotice from '../models/NrcNotice.js';
import SystemSetting from '../models/SystemSetting.js';
import logger from '../utils/logger.js';
import { countryNameFrom, isDrcNotice } from './nrcCountries.js';
import { classifyWorkplaces } from './africaWorkplace.js';
import { scoreNotice } from './nrcService.js';
import { fetchIcrcDetail, fetchIcrcJobs, icrcJobUrl } from '../scrapers/icrc.js';

const SYNC_KEY = 'icrc_sync';
const MAX_DETAILS = Math.max(1, Number(process.env.ICRC_MAX_DETAILS || 12));

let inFlight = null;

function parseWhen(value) {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

async function patchSync(patch) {
  const $set = {};
  for (const [key, value] of Object.entries(patch)) $set[`value.${key}`] = value;
  await SystemSetting.findOneAndUpdate({ key: SYNC_KEY }, { $set }, { upsert: true });
}

export function isIcrcSyncRunning() {
  return Boolean(inFlight);
}

export async function getIcrcSyncState() {
  const doc = await SystemSetting.findOne({ key: SYNC_KEY }).lean();
  return { ...(doc?.value || {}), running: isIcrcSyncRunning() };
}

async function runIcrcSync({ refreshDetails = false } = {}) {
  const cap = refreshDetails ? Math.max(MAX_DETAILS, 40) : MAX_DETAILS;
  await patchSync({ running: true, startedAt: new Date(), error: '' });
  const rows = await fetchIcrcJobs();
  const now = new Date();
  let detailed = 0;
  const seen = [];
  for (const row of rows) {
    const externalId = `icrc:${row.id}`;
    const existing = await NrcNotice.findOne({ externalId }).select('detailFetchedAt description countryCode location').lean();
    let detail = null;
    if ((refreshDetails || !existing?.detailFetchedAt) && detailed < cap) {
      detail = await fetchIcrcDetail(row.href);
      if (detail) detailed += 1;
    }
    const countryCode = detail?.countryCode || existing?.countryCode || '';
    const location = detail?.location || existing?.location || '';
    const description = detail?.description || existing?.description || '';
    const workplace = classifyWorkplaces({ countryCode, location, country: countryCode });
    const country = workplace.countryCode ? countryNameFrom(workplace.countryCode, location) : '';
    const scored = await scoreNotice(
      { kind: 'job', title: row.title, description, location, country, jobInfo: { category: '' } },
      { useAi: false }
    );
    if (!scored.isLogistics) continue;
    const deadline = parseWhen(detail?.deadline);
    const applyUrl = icrcJobUrl(row.href);
    await NrcNotice.updateOne(
      { externalId },
      {
        $set: {
          kind: 'job',
          organization: 'icrc',
          title: row.title,
          url: applyUrl,
          applyUrl,
          reference: row.id,
          country,
          countryCode: workplace.countryCode || '',
          location,
          locationScope: workplace.locationScope,
          isDrc: isDrcNotice({ countryCode: workplace.countryCode, country, location, title: row.title }),
          description,
          deadline: deadline || undefined,
          sortDeadline: deadline ? deadline.getTime() : 9e15,
          jobInfo: { category: '' },
          lastSeenAt: now,
          isArchived: false,
          archivedReason: '',
          ...(detail ? { detailFetchedAt: now } : {}),
          ...scored
        },
        $setOnInsert: { externalId, firstSeenAt: now, isNew: true }
      },
      { upsert: true }
    );
    seen.push({ pipeline: 'notice', platform: 'ICRC', externalId });
  }
  await patchSync({ running: false, lastRunAt: new Date(), found: seen.length, detailed, error: '' });
  logger.info(`ICRC: ${seen.length} poste(s) logistique, ${detailed} fiche(s)`);
  return seen;
}

export function syncIcrcNotices(options = {}) {
  if (inFlight) return inFlight;
  inFlight = runIcrcSync(options)
    .catch(async (e) => {
      logger.warn(`ICRC: ${e.message}`);
      await patchSync({ running: false, lastRunAt: new Date(), error: String(e.message || '').slice(0, 400) }).catch(() => {});
      throw e;
    })
    .finally(() => {
      inFlight = null;
    });
  return inFlight;
}

export async function scrapeIcrc() {
  return syncIcrcNotices();
}
