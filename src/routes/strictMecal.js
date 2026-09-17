import { Router } from 'express';
import Opportunity from '../models/Opportunity.js';
import { activeOpportunityFilter } from '../services/opportunityLifecycle.js';
import { STRICT_MECAL_CATEGORIES } from '../services/strictMecalMatchService.js';

const router = Router();

const SELECT =
  'title description organization platform location ville deadline deadlineUnspecified sourceUrl category strictMecalMatch isUrgent isNew isRecommended aiRelevanceScore aiAnalysis scrapedAt firstSeenAt createdAt postedDate';

router.get('/', async (req, res, next) => {
  try {
    const active = activeOpportunityFilter();
    const [confirmed, review, hors, pending, totalActive] = await Promise.all([
      Opportunity.find({
        ...active,
        'strictMecalMatch.status': 'metier_confirme'
      })
        .select(SELECT)
        .sort({ deadline: 1 })
        .lean(),
      Opportunity.find({
        ...active,
        'strictMecalMatch.status': 'a_verifier'
      })
        .select(SELECT)
        .sort({ deadline: 1 })
        .lean(),
      Opportunity.countDocuments({ ...active, 'strictMecalMatch.status': 'hors_metier' }),
      Opportunity.countDocuments(
        activeOpportunityFilter({
          $or: [{ strictMecalMatch: { $exists: false } }, { 'strictMecalMatch.status': { $exists: false } }]
        })
      ),
      Opportunity.countDocuments(active)
    ]);

    const byCategory = Object.fromEntries(Object.keys(STRICT_MECAL_CATEGORIES).map((k) => [k, []]));
    for (const item of confirmed) {
      const key = item.strictMecalMatch?.category;
      if (byCategory[key]) byCategory[key].push(item);
      else (byCategory.consultance || (byCategory.consultance = [])).push(item);
    }

    res.json({
      categories: STRICT_MECAL_CATEGORIES,
      byCategory,
      review,
      counts: {
        confirmed: confirmed.length,
        review: review.length,
        hors,
        pending,
        totalActive
      }
    });
  } catch (e) {
    next(e);
  }
});

export default router;
