import { Router } from 'express';
import { authMiddleware, attachUser } from '../middleware/auth.js';
import { getGmailConfigDiagnostics, isGmailConfigured } from '../config/gmail.js';
import {
  archiveMessage,
  buildGmailAuthUrl,
  deleteMessage,
  exchangeCodeForToken,
  getGmailStatus,
  getMessage,
  listMessages,
  markAsRead,
  replyToMessage,
  saveDraft,
  sendMessage
} from '../services/gmailService.js';

const frontendUrl = () => process.env.FRONTEND_URL || 'http://localhost:5173';

const router = Router();

router.get('/callback', async (req, res, next) => {
  const frontend = frontendUrl();
  if (req.query.error) {
    return res.redirect(`${frontend}/messaging?gmail_error=${encodeURIComponent(req.query.error)}`);
  }
  try {
    await exchangeCodeForToken(req.query.code, req.query.state);
    res.redirect(`${frontend}/messaging?gmail=connected`);
  } catch (e) {
    console.error('Erreur callback Gmail:', e.message);
    res.redirect(`${frontend}/messaging?gmail_error=callback_failed`);
  }
});

router.use(authMiddleware);
router.use(attachUser);

router.get('/auth-url', (req, res) => {
  if (!isGmailConfigured()) {
    return res.status(503).json({
      message: 'Configuration Gmail OAuth2 manquante.',
      hint: 'Définissez GMAIL_CLIENT_ID et GMAIL_CLIENT_SECRET dans backend/.env puis redémarrez le backend.',
      diagnostics: getGmailConfigDiagnostics()
    });
  }
  res.json({ authUrl: buildGmailAuthUrl(req.userId) });
});

router.get('/auth', (req, res, next) => {
  try {
    if (!isGmailConfigured()) {
      return res.redirect(`${frontendUrl()}/messaging?gmail_error=not_configured`);
    }
    res.redirect(buildGmailAuthUrl(req.userId));
  } catch (e) {
    next(e);
  }
});

router.get('/status', async (req, res, next) => {
  try {
    res.json(await getGmailStatus(req.userId));
  } catch (e) {
    next(e);
  }
});

router.get('/messages', async (req, res, next) => {
  try {
    const status = await getGmailStatus(req.userId);
    if (!status.connected) return res.json({ ...status, messages: [] });
    const messages = await listMessages(req.userId, {
      maxResults: req.query.maxResults,
      labelIds: req.query.labelIds
    });
    res.json({ ...status, messages });
  } catch (e) {
    next(e);
  }
});

router.get('/messages/:id', async (req, res, next) => {
  try {
    res.json(await getMessage(req.userId, req.params.id));
  } catch (e) {
    next(e);
  }
});

router.post('/send', async (req, res, next) => {
  try {
    res.json(await sendMessage(req.userId, req.body));
  } catch (e) {
    next(e);
  }
});

router.post('/reply/:id', async (req, res, next) => {
  try {
    res.json(await replyToMessage(req.userId, req.params.id, req.body));
  } catch (e) {
    next(e);
  }
});

router.put('/read/:id', async (req, res, next) => {
  try {
    res.json(await markAsRead(req.userId, req.params.id));
  } catch (e) {
    next(e);
  }
});

router.put('/archive/:id', async (req, res, next) => {
  try {
    res.json(await archiveMessage(req.userId, req.params.id));
  } catch (e) {
    next(e);
  }
});

router.delete('/messages/:id', async (req, res, next) => {
  try {
    res.json(await deleteMessage(req.userId, req.params.id));
  } catch (e) {
    next(e);
  }
});

router.post('/draft', async (req, res, next) => {
  try {
    res.json(await saveDraft(req.userId, req.body));
  } catch (e) {
    next(e);
  }
});

export default router;
