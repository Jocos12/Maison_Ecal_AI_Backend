import { Router } from 'express';
import { authMiddleware, attachUser } from '../middleware/auth.js';
import User from '../models/User.js';
import { sendTestNotification } from '../services/notificationService.js';

const router = Router();
router.use(authMiddleware);
router.use(attachUser);

router.get('/me', async (req, res, next) => {
  try {
    const user = await User.findById(req.userId).select('-password');
    if (!user) return res.status(404).json({ message: 'Not found' });
    res.json(user);
  } catch (e) {
    next(e);
  }
});

router.patch('/settings', async (req, res, next) => {
  try {
    const allowed = [
      'alertsEnabled',
      'alertFrequency',
      'keywords',
      'whatsappNumber',
      'digestEmail',
      'preferredLanguage',
      'name'
    ];
    const patch = {};
    for (const k of allowed) {
      if (req.body[k] !== undefined) patch[k] = req.body[k];
    }
    const user = await User.findByIdAndUpdate(req.userId, patch, { new: true }).select('-password');
    res.json(user);
  } catch (e) {
    next(e);
  }
});

router.post('/test-notification', async (req, res, next) => {
  try {
    const r = await sendTestNotification({
      email: req.body?.email,
      whatsappTo: req.body?.whatsappTo
    });
    res.json({ ok: true, channels: r });
  } catch (e) {
    next(e);
  }
});

export default router;
