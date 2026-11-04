import NrcNotice from '../models/NrcNotice.js';
import SystemSetting from '../models/SystemSetting.js';
import logger from '../utils/logger.js';
import { countryNameFrom, isDrcNotice } from './nrcCountries.js';
import { classifyWorkplaces } from './africaWorkplace.js';
import { scoreNotice } from './nrcService.js';
import { fetchIrcJobDetailGet, fetchIrcLogisticsJobs, publicJobUrl, requisitionId } from '../scrapers/irc.js';

const SYNC_KEY = 'irc_sync';
const MAX_DETAILS = Math.max(1, Number(process.env.IRC_MAX_DETAILS || 12));

let inFlight = null;

const clean = (value) => String(value || '').replace(/\s+/g, ' ').trim();

function emailsIn(text) {
  const found = String(text || '').match(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi) || [];
  return [...new Set(found.map((m) => m.toLowerCase()))].slice(0, 6);
}

function placeOf({ country = '', countryCode = '', location = '', additionalLocations = [], title = '', text = '' }) {
  const workplace = classifyWorkplaces({ country, countryCode, location, additionalLocations });
  const name = workplace.countryCode ? countryNameFrom(workplace.countryCode, workplace.country || country) : workplace.country;
  return {
    country: name || '',
    countryCode: workplace.countryCode || '',
    location,
    locationScope: workplace.locationScope,
    isDrc: isDrcNotice({ countryCode: workplace.countryCode, country: name || country, location, title, text })
  };
}

async function patchSync(patch) {
  const $set = {};
  for (const [key, value] of Object.entries(patch)) $set[`value.${key}`] = value;
  await SystemSetting.findOneAndUpdate({ key: SYNC_KEY }, { $set }, { upsert: true });
}

export function isIrcSyncRunning() {
  return Boolean(inFlight);
}

export async function getIrcSyncState() {
  const doc = await SystemSetting.findOne({ key: SYNC_KEY }).lean();
  return { ...(doc?.value || {}), running: isIrcSyncRunning() };
}

/** Persist IRC logistics jobs on NrcNotice. Does not create Opportunity rows. */
async function runIrcSync({ refreshDetails = false } = {}) {
  const started = new Date();
  await patchSync({ running: true, startedAt: started, error: '' });
  const cap = refreshDetails ? Math.max(MAX_DETAILS, 40) : MAX_DETAILS;
  const rows = await fetchIrcLogisticsJobs();
  const now = new Date();
  let detailed = 0;
  const seen = [];
  for (const row of rows) {
    const req = requisitionId(row);
    if (!req) continue;
    const externalId = `irc:${req}`;
    const existing = await NrcNotice.findOne({ externalId }).select('detailFetchedAt description').lean();
    let detail = null;
    if ((refreshDetails || !existing?.detailFetchedAt) && detailed < cap && row.externalPath) {
      detail = await fetchIrcJobDetailGet(row.externalPath);
      if (detail) detailed += 1;
    }
    const title = detail?.title || clean(row.title);
    const location = detail?.location || clean(row.locationsText);
    const description = detail?.description || existing?.description || '';
    const applyUrl = detail?.applyUrl || publicJobUrl(row.externalPath);
    const place = placeOf({
      country: detail?.country || '',
      countryCode: detail?.countryCode || '',
      location,
      additionalLocations: detail?.additionalLocations || [],
      title,
      text: description
    });
    const scored = await scoreNotice(
      { kind: 'job', title, description, location, country: place.country, jobInfo: { category: '' } },
      { useAi: false }
    );
    if (!scored.isLogistics) continue;
    const $set = {
      kind: 'job',
      organization: 'irc',
      title,
      url: applyUrl,
      applyUrl,
      reference: detail?.reference || req,
      noticeType: '',
      country: place.country,
      countryCode: place.countryCode,
      location: place.location,
      locationScope: place.locationScope,
      isDrc: place.isDrc,
      description: description.slice(0, 20000),
      contactEmails: emailsIn(description),
      jobInfo: { category: '' },
      lastSeenAt: now,
      isArchived: false,
      archivedReason: '',
      sortDeadline: 9e15,
      ...scored
    };
    if (detail) $set.detailFetchedAt = now;
    if (detail?.postedDate && !Number.isNaN(detail.postedDate.getTime())) $set.postedDate = detail.postedDate;
    await NrcNotice.updateOne(
      { externalId },
      { $set, $setOnInsert: { externalId, firstSeenAt: now, isNew: true } },
      { upsert: true }
    );
    seen.push({ pipeline: 'notice', platform: 'IRC', externalId });
  }
  await patchSync({
    running: false,
    lastRunAt: new Date(),
    found: seen.length,
    detailed,
    error: ''
  });
  logger.info(`IRC: ${seen.length} poste(s) logistique, ${detailed} fiche(s) lue(s)`);
  return seen;
}

export function syncIrcNotices(options = {}) {
  if (inFlight) return inFlight;
  inFlight = runIrcSync(options)
    .catch(async (e) => {
      logger.warn(`IRC: ${e.message}`);
      await patchSync({ running: false, lastRunAt: new Date(), error: String(e.message || '').slice(0, 400) }).catch(() => {});
      throw e;
    })
    .finally(() => {
      inFlight = null;
    });
  return inFlight;
}

/** Entry used by the hourly scan. A failure stays inside this source. */
export async function scrapeIrc() {
  return syncIrcNotices();
}
