import { Router } from 'express';
import mongoose from 'mongoose';
import rateLimit from 'express-rate-limit';
import Opportunity from '../models/Opportunity.js';
import { runAllScrapers } from '../scrapers/index.js';
import { sanitizeSearchParam } from '../services/filterService.js';
import { reclassifyOpportunities } from '../services/opportunityReclassifyService.js';

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
      sort = 'recent'
    } = req.query;

    const q = {};
    q.locationStatus = { $ne: 'hors_rdc' };
    q['aiAnalysis.est_emploi'] = { $ne: true };
    if (category) q.category = category;
    if (platform) q.platform = platform;
    if (isNew === 'true') q.isNew = true;
    if (isUrgent === 'true') q.isUrgent = true;
    if (country) q.location = new RegExp(String(country), 'i');
    if (ville) {
      const villes = Array.isArray(ville) ? ville : String(ville).split(',').map((v) => v.trim()).filter(Boolean);
      q.ville = villes.length > 1 ? { $in: villes } : villes[0];
    }
    if (archived === 'true' || status === 'archived') q.isArchived = true;
    else q.isArchived = false;

    const safeSearch = sanitizeSearchParam(search);
    if (safeSearch) {
      q.$text = { $search: safeSearch };
    }

    const p = Math.max(1, parseInt(page, 10) || 1);
    const l = Math.min(100, Math.max(1, parseInt(limit, 10) || 20));
    const skip = (p - 1) * l;

    let sortSpec = { createdAt: -1 };
    if (sort === 'deadline') sortSpec = { deadline: 1 };
    if (sort === 'platform') sortSpec = { platform: 1, createdAt: -1 };
    if (sort === 'relevance') sortSpec = { aiRelevanceScore: -1, createdAt: -1 };

    const [items, total] = await Promise.all([
      Opportunity.find(q)
        .sort(sortSpec)
        .skip(skip)
        .limit(l)
        .lean(),
      Opportunity.countDocuments(q)
    ]);

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

router.post('/reclassify', scrapeLimiter, async (req, res, next) => {
  try {
    if (!['Admin', 'admin'].includes(req.user?.role)) {
      return res.status(403).json({ message: 'Admin only' });
    }
    const useAI = req.body?.useAI === true;
    const summary = await reclassifyOpportunities({ useAI, dryRun: false, includeArchived: false });
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
    const summary = await runAllScrapers({ triggeredBy: req.user?.email || 'manual' });
    res.json(summary);
  } catch (e) {
    next(e);
  }
});

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
