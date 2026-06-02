import { Router } from 'express';
import Application from '../models/Application.js';

const router = Router();

router.get('/', async (req, res, next) => {
  try {
    const list = await Application.find()
      .populate('opportunity')
      .sort({ updatedAt: -1 })
      .lean();
    res.json(list);
  } catch (e) {
    next(e);
  }
});

router.post('/', async (req, res, next) => {
  try {
    const doc = await Application.create(req.body);
    const populated = await doc.populate('opportunity');
    res.status(201).json(populated);
  } catch (e) {
    next(e);
  }
});

router.patch('/:id', async (req, res, next) => {
  try {
    const doc = await Application.findByIdAndUpdate(req.params.id, req.body, {
      new: true,
      runValidators: true
    }).populate('opportunity');
    if (!doc) return res.status(404).json({ message: 'Not found' });
    res.json(doc);
  } catch (e) {
    next(e);
  }
});

router.delete('/:id', async (req, res, next) => {
  try {
    await Application.findByIdAndDelete(req.params.id);
    res.status(204).send();
  } catch (e) {
    next(e);
  }
});

export default router;
