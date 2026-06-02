import { Router } from 'express';
import Opportunity from '../models/Opportunity.js';
import ScrapeLog from '../models/ScrapeLog.js';

const router = Router();

router.get('/', async (_req, res, next) => {
  try {
    const since = new Date(Date.now() - 12 * 7 * 24 * 60 * 60 * 1000);
    const [byWeek, byCategory, bySource, relevance, logs] = await Promise.all([
      Opportunity.aggregate([
        { $match: { createdAt: { $gte: since } } },
        {
          $group: {
            _id: { $dateToString: { format: '%Y-%U', date: '$createdAt' } },
            count: { $sum: 1 }
          }
        },
        { $sort: { _id: 1 } }
      ]),
      Opportunity.aggregate([
        { $match: { isArchived: false } },
        { $group: { _id: '$category', count: { $sum: 1 } } },
        { $sort: { count: -1 } }
      ]),
      Opportunity.aggregate([
        { $match: { isArchived: false } },
        { $group: { _id: '$platform', count: { $sum: 1 } } },
        { $sort: { count: -1 } }
      ]),
      Opportunity.aggregate([
        { $match: { aiRelevanceScore: { $ne: null } } },
        { $group: { _id: null, avg: { $avg: '$aiRelevanceScore' } } }
      ]),
      ScrapeLog.find().sort({ startedAt: -1 }).limit(10).lean()
    ]);

    res.json({
      byWeek: byWeek.map((row) => ({ week: row._id, count: row.count })),
      byCategory: byCategory.map((row) => ({ category: row._id || 'Non classé', count: row.count })),
      bySource: bySource.map((row) => ({ source: row._id || 'Autre', count: row.count })),
      averageRelevance: relevance[0]?.avg || 0,
      logs
    });
  } catch (e) {
    next(e);
  }
});

export default router;
