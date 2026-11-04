import { Router } from 'express';
import rateLimit from 'express-rate-limit';
import NrcNotice from '../models/NrcNotice.js';
import { countryNameFrom } from '../services/nrcCountries.js';
import { getIrcSyncState, isIrcSyncRunning, syncIrcNotices } from '../services/ircNoticeService.js';
import { getDrcNgoSyncState, isDrcNgoSyncRunning, syncDrcNgoNotices } from '../services/drcNgoNoticeService.js';
import { getIcrcSyncState, isIcrcSyncRunning, syncIcrcNotices } from '../services/icrcNoticeService.js';
import logger from '../utils/logger.js';

const router = Router();

const syncLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  max: process.env.NODE_ENV === 'development' ? 100 : 6,
  standardHeaders: true,
  legacyHeaders: false,
  message: { message: 'Trop de mises à jour lancées. Réessayez plus tard.' }
});

const LIST_FIELDS = [
  'kind',
  'organization',
  'title',
  'url',
  'applyUrl',
  'reference',
  'noticeType',
  'country',
  'countryCode',
  'location',
  'isDrc',
  'postedDate',
  'deadline',
  'isNew',
  'isArchived',
  'score',
  'scoreLabel',
  'scoreReason',
  'scoreFactors',
  'matchedKeywords',
  'scoreProvider',
  'firstSeenAt',
  'detailFetchedAt',
  'jobInfo.category',
  'brief.generatedAt',
  'draft.generatedAt'
].join(' ');

const escapeRe = (s) => String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const VEILLE_ORGS = new Set(['irc', 'drcngo', 'icrc']);
const NOT_NRC = { $exists: true, $nin: ['nrc', ''] };

function veilleOrganization(filter, org) {
  const requested = String(org || 'all').toLowerCase();
  filter.organization = VEILLE_ORGS.has(requested) ? requested : NOT_NRC;
  return filter;
}

router.get('/', async (req, res, next) => {
  try {
    const { kind = 'all', country = '', drc = '', fit = '', q = '', status = 'open', sort = 'score', page = '1', limit = '20', org = 'all' } = req.query;
    const filter = { isLogistics: true };
    if (fit === 'true') filter.fitsMecal = true;
    if (kind === 'tender' || kind === 'job') filter.kind = kind;
    if (country) filter.countryCode = String(country).toUpperCase();
    if (drc === 'true') filter.isDrc = true;
    if (status === 'open') filter.isArchived = false;
    else if (status === 'closed') filter.isArchived = true;
    const search = String(q || '').trim().slice(0, 80);
    if (search) {
      const re = new RegExp(escapeRe(search), 'i');
      filter.$or = [{ title: re }, { reference: re }, { country: re }, { location: re }];
    }
    veilleOrganization(filter, org);
    filter.locationScope = 'africa';

    const order =
      sort === 'deadline' ? { sortDeadline: 1, score: -1 } : sort === 'recent' ? { postedDate: -1, firstSeenAt: -1 } : { score: -1, sortDeadline: 1 };
    const p = Math.max(1, parseInt(page, 10) || 1);
    const l = Math.min(50, Math.max(1, parseInt(limit, 10) || 20));
    const [items, total] = await Promise.all([
      NrcNotice.find(filter).select(LIST_FIELDS).sort(order).skip((p - 1) * l).limit(l).lean(),
      NrcNotice.countDocuments(filter)
    ]);
    res.json({ items, total, page: p, pages: Math.max(1, Math.ceil(total / l)) });
  } catch (e) {
    next(e);
  }
});

router.get('/meta', async (_req, res, next) => {
  try {
    const open = { isArchived: false, isLogistics: true, organization: NOT_NRC, locationScope: 'africa' };
    const soon = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);
    const [tenders, jobs, fitTenders, fitJobs, drc, closingSoon, countries, byOrg, ircSync, drcSync, icrcSync] = await Promise.all([
      NrcNotice.countDocuments({ ...open, kind: 'tender' }),
      NrcNotice.countDocuments({ ...open, kind: 'job' }),
      NrcNotice.countDocuments({ ...open, kind: 'tender', fitsMecal: true }),
      NrcNotice.countDocuments({ ...open, kind: 'job', fitsMecal: true }),
      NrcNotice.countDocuments({ ...open, isDrc: true }),
      NrcNotice.countDocuments({ ...open, deadline: { $gte: new Date(), $lte: soon } }),
      NrcNotice.aggregate([
        { $match: { ...open, countryCode: { $ne: '' } } },
        { $group: { _id: '$countryCode', count: { $sum: 1 } } },
        { $sort: { count: -1 } }
      ]),
      NrcNotice.aggregate([
        { $match: open },
        {
          $group: {
            _id: {
              $cond: [
                { $in: [{ $ifNull: ['$organization', 'nrc'] }, ['', 'nrc']] },
                'nrc',
                '$organization'
              ]
            },
            count: { $sum: 1 }
          }
        }
      ]),
      getIrcSyncState(),
      getDrcNgoSyncState(),
      getIcrcSyncState()
    ]);
    const counts = Object.fromEntries(byOrg.map((row) => [row._id, row.count]));
    const lastRunAt = [ircSync.lastRunAt, drcSync.lastRunAt, icrcSync.lastRunAt].filter(Boolean).sort().at(-1) || null;
    const sync = {
      running: Boolean(ircSync.running || drcSync.running || icrcSync.running),
      lastRunAt
    };
    res.json({
      tenders,
      jobs,
      fits: { tender: fitTenders, job: fitJobs, total: fitTenders + fitJobs },
      drc,
      closingSoon,
      countries: countries.map((c) => ({ code: c._id, name: countryNameFrom(c._id, c._id), count: c.count })),
      orgs: [
        { id: 'irc', label: 'IRC', count: counts.irc || 0 },
        { id: 'drcngo', label: 'DRC', count: counts.drcngo || 0 },
        { id: 'icrc', label: 'ICRC', count: counts.icrc || 0 }
      ],
      sync
    });
  } catch (e) {
    next(e);
  }
});

router.post('/sync', syncLimiter, async (_req, res, next) => {
  try {
    const already = isIrcSyncRunning() || isDrcNgoSyncRunning() || isIcrcSyncRunning();
    if (!isIrcSyncRunning()) syncIrcNotices().catch((e) => logger.warn(`Veille IRC: ${e.message}`));
    if (!isDrcNgoSyncRunning()) syncDrcNgoNotices().catch((e) => logger.warn(`Veille DRC: ${e.message}`));
    if (!isIcrcSyncRunning()) syncIcrcNotices().catch((e) => logger.warn(`Veille ICRC: ${e.message}`));
    const [ircSync, drcSync] = await Promise.all([getIrcSyncState(), getDrcNgoSyncState()]);
    res.status(202).json({
      status: already ? 'already_running' : 'started',
      sync: { running: true, lastRunAt: ircSync.lastRunAt || drcSync.lastRunAt || null }
    });
  } catch (e) {
    next(e);
  }
});

export default router;
