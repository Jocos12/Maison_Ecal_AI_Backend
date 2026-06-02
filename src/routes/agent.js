import { Router } from 'express';
import ScrapeLog from '../models/ScrapeLog.js';
import Source from '../models/Source.js';

const router = Router();

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

export default router;
