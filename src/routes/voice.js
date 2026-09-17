import { Router } from 'express';
import { processVoiceCommand } from '../services/voiceCommandService.js';

const router = Router();

/**
 * POST /api/voice/command
 * Body: { text, locale? }
 * Returns: { reply, actions:[{tool,args}], awaitConfirmation, provider }
 *
 * SECURITY: Draft creation is allowed. Email send / archive are never executed here.
 */
router.post('/command', async (req, res, next) => {
  try {
    const { text, locale } = req.body || {};
    if (!text || !String(text).trim()) {
      return res.status(400).json({ message: 'Champ text requis.' });
    }
    const result = await processVoiceCommand({ text, locale });
    res.json(result);
  } catch (e) {
    next(e);
  }
});

export default router;
