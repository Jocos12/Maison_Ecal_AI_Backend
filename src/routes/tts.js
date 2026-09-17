import { Router } from 'express';
import { getTtsConfig, synthesizeSpeech } from '../services/ttsService.js';

const router = Router();

router.get('/status', (_req, res) => {
  res.json(getTtsConfig());
});

/**
 * POST /api/tts
 * Body: { text, voice?: 'nova'|'shimmer'|'onyx', model?: 'tts-1'|'tts-1-hd' }
 * Returns: audio/mpeg binary
 */
router.post('/', async (req, res, next) => {
  try {
    const { text, voice, model } = req.body || {};
    if (!text || !String(text).trim()) {
      return res.status(400).json({ message: 'Champ text requis.' });
    }

    const audio = await synthesizeSpeech({ text, voice, model });
    res.setHeader('Content-Type', audio.contentType);
    res.setHeader('X-TTS-Voice', audio.voice);
    res.setHeader('X-TTS-Model', audio.model);
    res.setHeader('X-TTS-Chars', String(audio.chars));
    res.setHeader('Cache-Control', 'no-store');
    return res.send(audio.buffer);
  } catch (e) {
    next(e);
  }
});

export default router;
