import { Router } from 'express';
import mongoose from 'mongoose';
import rateLimit from 'express-rate-limit';
import NrcNotice from '../models/NrcNotice.js';
import logger from '../utils/logger.js';
import { getSyncState, isNrcSyncRunning, syncNrc } from '../services/nrcService.js';
import { generateBrief, generateDraft } from '../services/nrcAiService.js';
import { countryNameFrom } from '../services/nrcCountries.js';

const router = Router();

const syncLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  max: process.env.NODE_ENV === 'development' ? 100 : 6,
  standardHeaders: true,
  legacyHeaders: false,
  message: { message: 'Trop de mises à jour lancées. Réessayez plus tard.' }
});

const aiLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  max: process.env.NODE_ENV === 'development' ? 300 : 150,
  standardHeaders: true,
  legacyHeaders: false,
  message: { message: 'Trop de générations demandées. Réessayez plus tard.' }
});

const LIST_FIELDS = [
  'kind',
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
  'archivedReason',
  'score',
  'scoreLabel',
  'scoreReason',
  'scoreFactors',
  'matchedKeywords',
  'scoreProvider',
  'firstSeenAt',
  'detailFetchedAt',
  'jobInfo.category',
  'jobInfo.workplace',
  'brief.generatedAt',
  'draft.generatedAt'
].join(' ');

const escapeRe = (s) => String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const validId = (id) => mongoose.Types.ObjectId.isValid(id);

router.get('/', async (req, res, next) => {
  try {
    const { kind = 'all', country = '', drc = '', fit = '', q = '', status = 'open', sort = 'score', page = '1', limit = '20' } = req.query;
    // Only logistics notices are ever listed
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
    const open = { isArchived: false, isLogistics: true };
    const soon = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);
    const [tenders, jobs, fitTenders, fitJobs, drc, closingSoon, closed, hidden, countries, sync] = await Promise.all([
      NrcNotice.countDocuments({ ...open, kind: 'tender' }),
      NrcNotice.countDocuments({ ...open, kind: 'job' }),
      NrcNotice.countDocuments({ ...open, kind: 'tender', fitsMecal: true }),
      NrcNotice.countDocuments({ ...open, kind: 'job', fitsMecal: true }),
      NrcNotice.countDocuments({ ...open, isDrc: true }),
      NrcNotice.countDocuments({ ...open, deadline: { $gte: new Date(), $lte: soon } }),
      NrcNotice.countDocuments({ isArchived: true, isLogistics: true }),
      // open notices that are not about logistics, so left out of the list
      NrcNotice.countDocuments({ isArchived: false, isLogistics: false, classifiedAt: { $ne: null } }),
      NrcNotice.aggregate([
        { $match: { ...open, countryCode: { $ne: '' } } },
        { $group: { _id: '$countryCode', count: { $sum: 1 }, tenders: { $sum: { $cond: [{ $eq: ['$kind', 'tender'] }, 1, 0] } } } },
        { $sort: { count: -1 } }
      ]),
      getSyncState()
    ]);
    res.json({
      tenders,
      jobs,
      fits: { tender: fitTenders, job: fitJobs, total: fitTenders + fitJobs },
      drc,
      closingSoon,
      closed,
      hidden,
      countries: countries.map((c) => ({ code: c._id, name: countryNameFrom(c._id, c._id), count: c.count, tenders: c.tenders })),
      sync
    });
  } catch (e) {
    next(e);
  }
});

router.post('/sync', syncLimiter, async (_req, res, next) => {
  try {
    const already = isNrcSyncRunning();
    if (!already) {
      syncNrc({ trigger: 'manual' }).catch((e) => logger.error(`NRC sync manuelle: ${e.message}`));
    }
    res.status(202).json({ status: already ? 'already_running' : 'started', sync: { ...(await getSyncState()), running: true } });
  } catch (e) {
    next(e);
  }
});

async function loadNotice(req, res) {
  if (!validId(req.params.id)) {
    res.status(404).json({ message: 'Avis introuvable.' });
    return null;
  }
  const notice = await NrcNotice.findById(req.params.id);
  if (!notice) {
    res.status(404).json({ message: 'Avis introuvable.' });
    return null;
  }
  return notice;
}

router.get('/:id', async (req, res, next) => {
  try {
    if (!validId(req.params.id)) return res.status(404).json({ message: 'Avis introuvable.' });
    const notice = await NrcNotice.findById(req.params.id).select('-docText').lean();
    if (!notice) return res.status(404).json({ message: 'Avis introuvable.' });
    res.json(notice);
  } catch (e) {
    next(e);
  }
});

router.post('/:id/brief', aiLimiter, async (req, res, next) => {
  try {
    const notice = await loadNotice(req, res);
    if (!notice) return;
    const lang = ['fr', 'en', 'sw'].includes(req.body?.lang) ? req.body.lang : 'fr';
    if (!req.body?.force && notice.brief?.summary && notice.brief.language === lang) {
      return res.json(await NrcNotice.findById(notice._id).select('-docText').lean());
    }
    const brief = await generateBrief(notice.toObject(), { lang });
    notice.brief = brief;
    await notice.save();
    res.json(await NrcNotice.findById(notice._id).select('-docText').lean());
  } catch (e) {
    next(e);
  }
});

router.post('/:id/draft', aiLimiter, async (req, res, next) => {
  try {
    const notice = await loadNotice(req, res);
    if (!notice) return;
    const lang = req.body?.lang === 'fr' ? 'fr' : 'en';
    const tone = req.body?.tone === 'semi-formel' ? 'semi-formel' : 'formel';
    const draft = await generateDraft(notice.toObject(), { lang, tone, user: req.user });
    notice.draft = draft;
    await notice.save();
    res.json(await NrcNotice.findById(notice._id).select('-docText').lean());
  } catch (e) {
    next(e);
  }
});

// Save the draft as edited by the person
router.put('/:id/draft', async (req, res, next) => {
  try {
    const notice = await loadNotice(req, res);
    if (!notice) return;
    const { to = '', subject = '', body = '' } = req.body || {};
    notice.draft = {
      ...(notice.draft?.toObject?.() || {}),
      to: String(to).slice(0, 200),
      subject: String(subject).slice(0, 300),
      body: String(body).slice(0, 12000)
    };
    await notice.save();
    res.json({ ok: true });
  } catch (e) {
    next(e);
  }
});

export default router;
