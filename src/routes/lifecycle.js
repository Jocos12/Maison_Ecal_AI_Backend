import { Router } from 'express';
import { advanceLifecycle, archiveLifecycle, listLifecycle } from '../services/lifecycleService.js';
import { actorFromRequest } from '../services/auditService.js';

const router = Router();

router.get('/', async (req, res, next) => {
  try {
    const rows = await listLifecycle({ archived: req.query.archived === '1' });
    res.json(rows);
  } catch (e) {
    next(e);
  }
});

router.post('/:kind/:id/advance', async (req, res, next) => {
  try {
    const result = await advanceLifecycle(req.params.kind, req.params.id, req.user, actorFromRequest(req));
    if (result.error) return res.status(result.error).json({ message: result.message });
    res.json(result.row);
  } catch (e) {
    next(e);
  }
});

router.post('/:kind/:id/archive', async (req, res, next) => {
  try {
    const result = await archiveLifecycle(req.params.kind, req.params.id, req.user, actorFromRequest(req));
    if (result.error) return res.status(result.error).json({ message: result.message });
    res.json(result.row);
  } catch (e) {
    next(e);
  }
});

export default router;
