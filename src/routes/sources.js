import { Router } from 'express';
import rateLimit from 'express-rate-limit';
import Source from '../models/Source.js';
import Opportunity from '../models/Opportunity.js';
import { ensureDefaultSources } from '../services/sourceService.js';
import { activeOpportunityFilter } from '../services/opportunityLifecycle.js';
import { passesMecalListingFilter } from '../services/filterService.js';
import { isScrapeInFlight, runAllScrapers } from '../scrapers/index.js';

const router = Router();

const scrapeLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  max: process.env.NODE_ENV === 'development' ? 100 : 8,
  standardHeaders: true,
  legacyHeaders: false,
  message: { message: 'Trop de collectes lancées. Réessayez plus tard.' }
});

const PLATFORM_ALIASES = {
  UNGMVeille: ['UNGM'],
  AfDBVeille: ['AfDB'],
  DevExVeille: ['DevEx']
};

export function platformsForSource(source) {
  const key = source.scraperKey || source.key || '';
  if (PLATFORM_ALIASES[key]) return PLATFORM_ALIASES[key];
  return [...new Set([key, source.name].filter(Boolean))];
}

function inactiveReason(source) {
  if (source.enabled !== false) return '';
  if (!source.scraperKey) {
    return 'Aucun scraper automatique : cette source est prévue pour une veille manuelle ou l’Assistant Emploi.';
  }
  return source.description || 'Source désactivée. Réactivez-la pour l’inclure dans les scans.';
}

function healthOf(source, relevantCount) {
  if (source.lastStatus === 'error') return 'error';
  if (source.enabled === false) return 'inactive';
  if (relevantCount > 0) return 'healthy';
  return 'empty';
}

router.get('/', async (_req, res, next) => {
  try {
    await ensureDefaultSources();
    const [sources, active] = await Promise.all([
      Source.find().sort({ name: 1 }).lean(),
      Opportunity.find(activeOpportunityFilter())
        .select(
          'title organization platform category ville location locationStatus sourceUrl deadline scrapedAt aiRelevanceScore aiAnalysis isRecommended isArchived'
        )
        .sort({ aiRelevanceScore: -1, createdAt: -1 })
        .lean()
    ]);

    const listed = active.filter(passesMecalListingFilter);
    const byPlatform = {};
    for (const opp of listed) {
      const p = opp.platform || 'Other';
      if (!byPlatform[p]) byPlatform[p] = [];
      byPlatform[p].push(opp);
    }

    res.json({
      sources: sources.map((source) => {
        const platforms = platformsForSource(source);
        const offers = platforms.flatMap((p) => byPlatform[p] || []);
        const unique = [];
        const seen = new Set();
        for (const o of offers) {
          const id = String(o._id);
          if (seen.has(id)) continue;
          seen.add(id);
          unique.push(o);
        }
        const relevantCount = unique.length;
        return {
          ...source,
          opportunitiesCount: relevantCount,
          relevantCount,
          lastScrapedAt: source.lastScrapedAt || null,
          lastRawCount: source.lastRawCount || 0,
          lastErrorMessage: source.lastErrorMessage || '',
          inactiveReason: inactiveReason(source),
          health: healthOf(source, relevantCount),
          sampleOffers: unique.slice(0, 8)
        };
      }),
      opportunities: listed
    });
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

router.post('/:id/scrape', scrapeLimiter, async (req, res, next) => {
  try {
    if (!['Admin', 'admin'].includes(req.user?.role)) {
      return res.status(403).json({ message: 'Admin only' });
    }
    const source = await Source.findById(req.params.id).lean();
    if (!source) return res.status(404).json({ message: 'Source introuvable.' });
    const key = source.scraperKey;
    if (!key) {
      return res.status(400).json({ message: 'Cette source n’a pas de scraper automatique.' });
    }
    if (isScrapeInFlight()) {
      return res.status(409).json({ message: 'Une collecte est déjà en cours.' });
    }
    const summary = await runAllScrapers({
      triggeredBy: `source:${req.user?.email || 'manual'}:${key}`,
      onlyKeys: [key]
    });
    res.json({ ok: true, scraperKey: key, ...summary });
  } catch (e) {
    next(e);
  }
});

export default router;
