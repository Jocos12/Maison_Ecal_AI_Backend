import { Router } from 'express';
import { listCategoryDashboard, patchCategorySetting } from '../services/categorySettingsService.js';

const router = Router();

router.get('/', async (_req, res, next) => {
  try {
    const items = await listCategoryDashboard();
    res.json({ items });
  } catch (e) {
    next(e);
  }
});

router.patch('/:slug', async (req, res, next) => {
  try {
    const item = await patchCategorySetting(req.params.slug, req.body || {});
    if (!item) return res.status(404).json({ message: 'Catégorie inconnue' });
    res.json(item);
  } catch (e) {
    next(e);
  }
});

export default router;
