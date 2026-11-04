import { Router } from 'express';
import { listAudit } from '../services/auditService.js';

const router = Router();

function isAdmin(user) {
  return user && ['Admin', 'admin'].includes(user.role);
}

router.get('/', async (req, res, next) => {
  try {
    if (!isAdmin(req.user)) return res.status(403).json({ message: 'Réservé aux administrateurs.' });
    const rows = await listAudit({
      action: req.query.action || '',
      actor: req.query.actor || '',
      entity: req.query.entity || '',
      from: req.query.from || '',
      to: req.query.to || '',
      q: req.query.q || ''
    });
    res.json(rows);
  } catch (e) {
    next(e);
  }
});

export default router;
