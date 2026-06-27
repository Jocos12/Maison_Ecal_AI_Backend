import { Router } from 'express';
import ScrapeLog from '../models/ScrapeLog.js';
import Source from '../models/Source.js';
import {
  getSkipCategoryAdvice,
  rejectReasonLabel,
  SKIP_REASON_LABELS
} from '../services/agentSkipAdviceService.js';
import { getAgentSystemSnapshot } from '../services/agentContextService.js';

const router = Router();

function mapSkippedItem(item) {
  return {
    title: item.title,
    source: item.source || item.platform || item.organization || 'Inconnue',
    date: item.date ? new Date(item.date).toLocaleDateString('fr-FR') : '',
    score: item.score,
    rejectReason: rejectReasonLabel(item.reasonKey),
    reasonKey: item.reasonKey,
    description: item.description || '',
    url: item.url || ''
  };
}

router.get('/context', async (req, res, next) => {
  try {
    const snapshot = await getAgentSystemSnapshot(req.userId);
    res.json(snapshot);
  } catch (e) {
    next(e);
  }
});

router.get('/status', async (_req, res, next) => {
  try {
    const [lastLog, running, activeSources] = await Promise.all([
      ScrapeLog.findOne().sort({ startedAt: -1 }).lean(),
      ScrapeLog.countDocuments({ status: 'running' }),
      Source.countDocuments({ enabled: true })
    ]);
    res.json({
      active: running > 0,
      activeSources,
      lastSearchAt: lastLog?.startedAt || null,
      lastSummary: lastLog || null,
      schedules: ['0 */6 * * *', '0 */12 * * *', '0 0 * * *']
    });
  } catch (e) {
    next(e);
  }
});

router.get('/logs', async (_req, res, next) => {
  try {
    const logs = await ScrapeLog.find().sort({ startedAt: -1 }).limit(30).lean();
    res.json(logs);
  } catch (e) {
    next(e);
  }
});

router.get('/logs/:id/skipped/:reasonKey', async (req, res, next) => {
  try {
    const log = await ScrapeLog.findById(req.params.id).lean();
    if (!log) return res.status(404).json({ message: 'Collecte introuvable' });

    const reasonKey = req.params.reasonKey;
    const items = (log.skippedItems || [])
      .filter((item) => item.reasonKey === reasonKey)
      .map(mapSkippedItem);

    res.json({
      logId: log._id,
      logDate: log.startedAt,
      reasonKey,
      label: SKIP_REASON_LABELS[reasonKey] || reasonKey,
      count: log.skipReasons?.[reasonKey] ?? items.length,
      offers: items
    });
  } catch (e) {
    next(e);
  }
});

router.post('/logs/:id/skip-advice', async (req, res, next) => {
  try {
    const { reasonKey, message, history = [] } = req.body || {};
    if (!reasonKey || !message?.trim()) {
      return res.status(400).json({ message: 'reasonKey et message requis' });
    }

    const log = await ScrapeLog.findById(req.params.id).lean();
    if (!log) return res.status(404).json({ message: 'Collecte introuvable' });

    const offers = (log.skippedItems || [])
      .filter((item) => item.reasonKey === reasonKey)
      .map(mapSkippedItem);

    const categoryLabel = SKIP_REASON_LABELS[reasonKey] || reasonKey;
    const logDate = log.startedAt
      ? new Date(log.startedAt).toLocaleString('fr-FR')
      : '';

    const { reply } = await getSkipCategoryAdvice({
      categoryLabel,
      count: log.skipReasons?.[reasonKey] ?? offers.length,
      logDate,
      offers,
      userMessage: message.trim(),
      history
    });

    res.json({ reply });
  } catch (e) {
    next(e);
  }
});

export default router;
