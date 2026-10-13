import { Router } from 'express';
import mongoose from 'mongoose';
import {
  listMatchAlerts,
  markAllMatchAlertsRead,
  markMatchAlertRead
} from '../services/matchAlertService.js';
import {
  listScanAlerts,
  markAllScanAlertsRead,
  markScanAlertRead
} from '../services/scanAlertService.js';

const router = Router();

router.get('/', async (req, res, next) => {
  try {
    const unreadOnly = req.query.unread === '1' || req.query.unread === 'true';
    if (req.query.kind === 'scan') {
      const items = await listScanAlerts({ unreadOnly, limit: req.query.limit });
      return res.json({
        items,
        unreadCount: unreadOnly ? items.length : items.filter((n) => !n.readAt).length
      });
    }
    const items = await listMatchAlerts({ unreadOnly, limit: req.query.limit });
    res.json({
      items,
      unreadCount: unreadOnly ? items.length : items.filter((n) => !n.readAt).length
    });
  } catch (e) {
    next(e);
  }
});

router.patch('/read-all', async (_req, res, next) => {
  try {
    const matches = await markAllMatchAlertsRead();
    const scans = await markAllScanAlertsRead();
    res.json({ modified: (matches.modified || 0) + (scans.modified || 0) });
  } catch (e) {
    next(e);
  }
});

router.patch('/:id/read', async (req, res, next) => {
  try {
    if (!mongoose.isValidObjectId(req.params.id)) {
      return res.status(400).json({ message: 'Invalid id' });
    }
    const doc = (await markMatchAlertRead(req.params.id)) || (await markScanAlertRead(req.params.id));
    if (!doc) return res.status(404).json({ message: 'Not found' });
    res.json(doc);
  } catch (e) {
    next(e);
  }
});

export default router;
