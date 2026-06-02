import { Router } from 'express';
import Opportunity from '../models/Opportunity.js';
import Application from '../models/Application.js';

const router = Router();

router.get('/', async (req, res, next) => {
  try {
    const weekAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
    const soon = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);

    const [
      totalActive,
      newThisWeek,
      inProgress,
      closingSoon,
      lastAgg
    ] = await Promise.all([
      Opportunity.countDocuments({ isArchived: false }),
      Opportunity.countDocuments({ isArchived: false, createdAt: { $gte: weekAgo } }),
      Application.countDocuments({
        status: { $in: ['submitted', 'pending', 'interview'] }
      }),
      Opportunity.countDocuments({
        isArchived: false,
        deadline: { $gte: new Date(), $lte: soon }
      }),
      Opportunity.aggregate([
        { $match: {} },
        { $group: { _id: null, last: { $max: '$scrapedAt' } } }
      ])
    ]);

    const lastScrapeAt = lastAgg[0]?.last || null;

    res.json({
      totalActive,
      newThisWeek,
      applicationsInProgress: inProgress,
      closingSoon,
      lastScrapeAt
    });
  } catch (e) {
    next(e);
  }
});

export default router;
