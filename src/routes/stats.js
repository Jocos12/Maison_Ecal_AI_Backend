import { Router } from 'express';
import Opportunity from '../models/Opportunity.js';
import Application from '../models/Application.js';
import ScrapeLog from '../models/ScrapeLog.js';
import {
  activeOpportunityFilter,
  archiveInactiveOpportunities,
  freezeAndSyncNewFlags,
  startOfTodayKinshasa
} from '../services/opportunityLifecycle.js';
import { NEW_OPPORTUNITY_DAYS, HIGH_RELEVANCE_THRESHOLD, SCRAPE_STALE_AFTER_MS } from '../config/constants.js';
import { getScrapeWatchStatus, findLastSuccessfulScrape } from '../services/scrapeWatchdog.js';
import { listScanAlerts } from '../services/scanAlertService.js';
import { getAiDegradedMode } from '../services/aiDegradedMode.js';
import { buildMarketRelevancePayload } from '../services/scanRelevanceStats.js';

const router = Router();

router.get('/', async (req, res, next) => {
  try {
    await archiveInactiveOpportunities();
    await freezeAndSyncNewFlags();
    const weekAgo = new Date(Date.now() - NEW_OPPORTUNITY_DAYS * 24 * 60 * 60 * 1000);
    const soon = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);
    const cutoff = startOfTodayKinshasa();
    const active = activeOpportunityFilter();

    const [
      totalActive,
      newThisWeek,
      inProgress,
      closingSoon,
      recommendedCount,
      recommended,
      lastLog,
      recentLogs,
      watch,
      followUpsDue,
      lastSuccess,
      scanAlerts,
      aiDegraded,
      rollingSuccessLogs
    ] = await Promise.all([
      Opportunity.countDocuments(active),
      Opportunity.countDocuments(
        activeOpportunityFilter({
          $or: [{ firstSeenAt: { $gte: weekAgo } }, { firstSeenAt: null, createdAt: { $gte: weekAgo } }]
        })
      ),
      Application.countDocuments({
        status: { $in: ['submitted', 'pending', 'interview'] }
      }),
      Opportunity.countDocuments({
        isArchived: false,
        deadline: { $gte: cutoff, $lte: soon }
      }),
      Opportunity.countDocuments(activeOpportunityFilter({ isRecommended: true })),
      Opportunity.find(activeOpportunityFilter({ isRecommended: true }))
        .sort({ aiRelevanceScore: -1, createdAt: -1 })
        .limit(5)
        .select('title organization platform aiRelevanceScore sourceUrl')
        .lean(),
      ScrapeLog.findOne({ status: { $in: ['success', 'running'] } })
        .sort({ startedAt: -1 })
        .lean(),
      ScrapeLog.find()
        .sort({ startedAt: -1 })
        .limit(8)
        .select(
          'startedAt finishedAt status totalRaw saved skipped archivedExpired archivedStale archivedTotal message errors triggeredBy aiProvider aiProviders recommendedCount scoredCount skipReasons failureKind filterRetentionPct relevancePct globalRelevancePct skipReasonPercents'
        )
        .lean(),
      getScrapeWatchStatus(),
      Application.find({
        followUpDate: { $ne: null, $lte: new Date() },
        status: { $in: ['draft', 'submitted', 'pending', 'interview'] }
      })
        .populate('opportunity', 'title organization')
        .sort({ followUpDate: 1 })
        .limit(8)
        .lean(),
      findLastSuccessfulScrape(),
      listScanAlerts({ unreadOnly: true, limit: 8 }),
      getAiDegradedMode(),
      ScrapeLog.find({ status: 'success', totalRaw: { $gt: 0 } })
        .sort({ startedAt: -1 })
        .limit(10)
        .select(
          'startedAt finishedAt totalRaw skipped recommendedCount scoredCount skipReasons filterRetentionPct relevancePct globalRelevancePct'
        )
        .lean()
    ]);

    const successAt = lastSuccess?.finishedAt || lastSuccess?.startedAt;
    const currentScanAlerts = successAt
      ? scanAlerts.filter((a) => new Date(a.createdAt).getTime() > new Date(successAt).getTime())
      : scanAlerts;

    res.json({
      totalActive,
      newThisWeek,
      applicationsInProgress: inProgress,
      closingSoon,
      recommendedCount,
      recommendedOffers: recommended,
      highRelevanceThreshold: HIGH_RELEVANCE_THRESHOLD,
      lastScrapeAt: watch.lastScrapeAt || lastSuccess?.finishedAt || lastLog?.startedAt || null,
      lastAiProvider: lastSuccess?.aiProvider || lastLog?.aiProvider || '',
      aiDegraded,
      scrapeOverdue: watch.overdue,
      scrapeFailed: Boolean(watch.lastFailed),
      scrapeWatch: watch,
      scanAlerts: currentScanAlerts,
      scrapeInterval: process.env.SCRAPE_CRON || '*/30 * * * *',
      scrapeStaleAfterMs: SCRAPE_STALE_AFTER_MS,
      recentScrapes: recentLogs,
      marketRelevance: buildMarketRelevancePayload({
        lastSuccessLog: lastSuccess,
        rollingLogs: rollingSuccessLogs,
        threshold: HIGH_RELEVANCE_THRESHOLD
      }),
      followUpsDue: followUpsDue.map((a) => ({
        id: String(a._id),
        followUpDate: a.followUpDate,
        title: a.opportunity?.title || 'Candidature',
        organization: a.opportunity?.organization || ''
      }))
    });
  } catch (e) {
    next(e);
  }
});

const SCRAPE_LIST_FIELDS =
  'startedAt finishedAt status totalRaw saved skipped archivedExpired archivedStale archivedTotal message errors triggeredBy aiProvider aiProviders recommendedCount scoredCount failureKind';

function parseDate(value) {
  if (!value) return null;
  const d = new Date(String(value));
  return Number.isNaN(d.getTime()) ? null : d;
}

/**
 * Collection history, newest first, one page at a time. `from` and `to` (ISO dates) keep only the runs that
 * finished (or, when still running, started) inside that window, so the list changes with the date and time asked.
 */
router.get('/scrapes', async (req, res, next) => {
  try {
    const page = Math.max(1, parseInt(req.query.page, 10) || 1);
    const limit = Math.min(20, Math.max(1, parseInt(req.query.limit, 10) || 5));
    const from = parseDate(req.query.from);
    const to = parseDate(req.query.to);

    const filter = {};
    if (from || to) {
      const range = {};
      if (from) range.$gte = from;
      if (to) range.$lte = to;
      filter.$or = [{ finishedAt: range }, { finishedAt: { $in: [null] }, startedAt: range }];
    }

    const [items, total] = await Promise.all([
      ScrapeLog.find(filter)
        .sort({ startedAt: -1 })
        .skip((page - 1) * limit)
        .limit(limit)
        .select(SCRAPE_LIST_FIELDS)
        .lean(),
      ScrapeLog.countDocuments(filter)
    ]);

    res.json({ items, total, page, limit, pages: Math.max(1, Math.ceil(total / limit)) });
  } catch (e) {
    next(e);
  }
});

export default router;
