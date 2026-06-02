import { Router } from 'express';
import Source from '../models/Source.js';
import Opportunity from '../models/Opportunity.js';
import { ensureDefaultSources } from '../services/sourceService.js';

const router = Router();

router.get('/', async (_req, res, next) => {
  try {
    await ensureDefaultSources();
    const [sources, counts] = await Promise.all([
      Source.find().sort({ name: 1 }).lean(),
      Opportunity.aggregate([
        { $match: { isArchived: false } },
        { $group: { _id: '$platform', count: { $sum: 1 } } }
      ])
    ]);
    const countMap = new Map(counts.map((row) => [row._id, row.count]));
    res.json(sources.map((source) => ({ ...source, opportunitiesCount: countMap.get(source.scraperKey || source.key) || 0 })));
  } catch (e) {
    next(e);
  }
});

router.put('/:id', async (req, res, next) => {
  try {
    const { enabled, frequencyHours, url } = req.body || {};
    const patch = {};
    if (typeof enabled === 'boolean') patch.enabled = enabled;
    if (frequencyHours) patch.frequencyHours = Math.max(1, Number(frequencyHours));
    if (url) patch.url = String(url).trim();
    const doc = await Source.findByIdAndUpdate(req.params.id, patch, { new: true, runValidators: true });
    if (!doc) return res.status(404).json({ message: 'Source introuvable.' });
    res.json(doc);
  } catch (e) {
    next(e);
  }
});

export default router;
