import { Router } from 'express';
import mongoose from 'mongoose';
import rateLimit from 'express-rate-limit';
import Opportunity from '../models/Opportunity.js';
import { runAllScrapers, isScrapeInFlight, QUICK_SCRAPER_KEYS } from '../scrapers/index.js';
import logger from '../utils/logger.js';
import { sanitizeSearchParam } from '../services/filterService.js';
import { archiveInactiveOpportunities, activeOpportunityFilter, freezeAndSyncNewFlags } from '../services/opportunityLifecycle.js';
import { getApplyGuide } from '../services/applyGuideService.js';
import { handleOpportunityAsk } from '../services/opportunityAskService.js';
import { rescoreStoredOpportunities } from '../services/opportunityRescoreService.js';

const scrapeLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  max: process.env.NODE_ENV === 'development' ? 100 : 5,
  standardHeaders: true,
  legacyHeaders: false,
  message: { message: 'Trop de collectes lancées. Réessayez plus tard.' },
  skipSuccessfulRequests: process.env.NODE_ENV === 'development'
});

const router = Router();

router.get('/', async (req, res, next) => {
  try {
    await archiveInactiveOpportunities();
    await freezeAndSyncNewFlags();
    const {
      category,
      platform,
      isNew,
      isUrgent,
      archived,
      country,
      ville,
      status,
      search,
      page = '1',
      limit = '20',
      sort = 'relevance'
    } = req.query;

    const q = {};
    q.locationStatus = { $ne: 'hors_rdc' };
    q['aiAnalysis.est_emploi'] = { $ne: true };
    if (category) q.category = category;
    if (platform) q.platform = platform;
    if (isNew === 'true') q.isNew = true;
    if (isUrgent === 'true') {
      const soon = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);
      q.$and = [
        ...(q.$and || []),
        {
          $or: [{ isUrgent: true }, { deadline: { $gte: new Date(), $lte: soon } }]
        }
      ];
    }
    if (country) {
      const re = new RegExp(String(country), 'i');
      q.$and = [...(q.$and || []), { $or: [{ location: re }, { ville: re }, { organization: re }] }];
    }
    if (ville) {
      const villes = Array.isArray(ville) ? ville : String(ville).split(',').map((v) => v.trim()).filter(Boolean);
      q.ville = villes.length > 1 ? { $in: villes } : villes[0];
    }
    if (archived === 'true' || status === 'archived') q.isArchived = true;
    else Object.assign(q, activeOpportunityFilter());

    const safeSearch = sanitizeSearchParam(search);
    if (safeSearch) {
      q.$text = { $search: safeSearch };
    }

    const p = Math.max(1, parseInt(page, 10) || 1);
    const l = Math.min(100, Math.max(1, parseInt(limit, 10) || 20));
    const skip = (p - 1) * l;

    const now = new Date();
    let items;
    const total = await Opportunity.countDocuments(q);

    if (sort === 'recent') {
      items = await Opportunity.find(q).sort({ createdAt: -1 }).skip(skip).limit(l).lean();
    } else if (sort === 'deadline') {
      items = await Opportunity.find(q).sort({ deadline: 1 }).skip(skip).limit(l).lean();
    } else if (sort === 'platform') {
      items = await Opportunity.find(q).sort({ platform: 1, createdAt: -1 }).skip(skip).limit(l).lean();
    } else {
      items = await Opportunity.aggregate([
        { $match: q },
        {
          $addFields: {
            _urgency: {
              $cond: [
                { $not: ['$deadline'] },
                0,
                {
                  $let: {
                    vars: {
                      days: { $divide: [{ $subtract: ['$deadline', now] }, 86400000] }
                    },
                    in: {
                      $cond: [
                        { $lt: ['$$days', 0] },
                        0,
                        {
                          $cond: [
                            { $lte: ['$$days', 7] },
                            3,
                            { $cond: [{ $lte: ['$$days', 15] }, 2, 1] }
                          ]
                        }
                      ]
                    }
                  }
                }
              ]
            }
          }
        },
        { $sort: { _urgency: -1, isRecommended: -1, aiRelevanceScore: -1, deadline: 1 } },
        { $skip: skip },
        { $limit: l },
        { $project: { _urgency: 0 } }
      ]);
    }

    res.json({
      data: items,
      page: p,
      limit: l,
      total,
      pages: Math.ceil(total / l)
    });
  } catch (e) {
    next(e);
  }
});

router.post('/rescore', scrapeLimiter, async (req, res, next) => {
  try {
    if (!['Admin', 'admin'].includes(req.user?.role)) {
      return res.status(403).json({ message: 'Admin only' });
    }
    const useAI = req.body?.useAI === true;
    const includeArchived = req.body?.includeArchived === true;
    const summary = await rescoreStoredOpportunities({ useAI, dryRun: false, includeArchived });
    res.json(summary);
  } catch (e) {
    next(e);
  }
});

router.post('/reclassify', scrapeLimiter, async (req, res, next) => {
  try {
    if (!['Admin', 'admin'].includes(req.user?.role)) {
      return res.status(403).json({ message: 'Admin only' });
    }
    const useAI = req.body?.useAI === true;
    const summary = await rescoreStoredOpportunities({ useAI, dryRun: false, includeArchived: false });
    res.json(summary);
  } catch (e) {
    next(e);
  }
});

router.post('/scrape', scrapeLimiter, async (req, res, next) => {
  try {
    if (!['Admin', 'admin'].includes(req.user?.role)) {
      return res.status(403).json({ message: 'Admin only' });
    }
    const triggeredBy = req.user?.email || 'manual';
    // A full scan takes several minutes: with { background: true } answer at once (202) and let the
    // client follow the progress with GET /scrape/status instead of holding the request open.
    // { quick: true } scans only the fast sources, side by side (about ten seconds instead of ten minutes).
    if (req.body?.background === true) {
      const alreadyRunning = isScrapeInFlight();
      if (!alreadyRunning) {
        const scanOptions =
          req.body?.quick === true ? { onlyKeys: QUICK_SCRAPER_KEYS, parallel: true } : {};
        runAllScrapers({ triggeredBy, ...scanOptions }).catch((err) => {
          logger.warn(`Collecte manuelle en échec: ${err?.message || err}`);
        });
      }
      return res.status(202).json({ started: !alreadyRunning, running: true });
    }
    const summary = await runAllScrapers({ triggeredBy });
    res.json(summary);
  } catch (e) {
    next(e);
  }
});

router.get('/scrape/status', (_req, res) => {
  res.json({ running: isScrapeInFlight() });
});

router.get('/:id/apply-guide', async (req, res, next) => {
  try {
    const { id } = req.params;
    if (!mongoose.isValidObjectId(id)) return res.status(400).json({ message: 'Invalid id' });
    const refresh = req.query.refresh === '1' || req.query.refresh === 'true';
    const applyIntel = await getApplyGuide(id, { refresh });
    res.json(applyIntel);
  } catch (e) {
    next(e);
  }
});

router.post('/:id/apply-guide', async (req, res, next) => {
  try {
    const { id } = req.params;
    if (!mongoose.isValidObjectId(id)) return res.status(400).json({ message: 'Invalid id' });
    const applyIntel = await getApplyGuide(id, { refresh: true });
    res.json(applyIntel);
  } catch (e) {
    next(e);
  }
});

router.post('/:id/ask', handleOpportunityAsk);

router.get('/:id', async (req, res, next) => {
  try {
    const { id } = req.params;
    if (!mongoose.isValidObjectId(id)) return res.status(400).json({ message: 'Invalid id' });
    const doc = await Opportunity.findById(id).lean();
    if (!doc) return res.status(404).json({ message: 'Not found' });
    res.json(doc);
  } catch (e) {
    next(e);
  }
});

router.patch('/:id/archive', async (req, res, next) => {
  try {
    const doc = await Opportunity.findByIdAndUpdate(
      req.params.id,
      { $set: { isArchived: true, isNew: false } },
      { new: true }
    );
    if (!doc) return res.status(404).json({ message: 'Not found' });
    res.json(doc);
  } catch (e) {
    next(e);
  }
});

router.patch('/:id/unarchive', async (req, res, next) => {
  try {
    const doc = await Opportunity.findByIdAndUpdate(
      req.params.id,
      { $set: { isArchived: false, isNew: false } },
      { new: true }
    );
    if (!doc) return res.status(404).json({ message: 'Not found' });
    res.json(doc);
  } catch (e) {
    next(e);
  }
});

router.delete('/:id', async (req, res, next) => {
  try {
    if (!['Admin', 'admin'].includes(req.user?.role)) {
      return res.status(403).json({ message: 'Admin only' });
    }
    await Opportunity.findByIdAndDelete(req.params.id);
    res.status(204).send();
  } catch (e) {
    next(e);
  }
});

export default router;
