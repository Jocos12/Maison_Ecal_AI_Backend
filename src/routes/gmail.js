import { Router } from 'express';
import { authMiddleware, attachUser } from '../middleware/auth.js';
import { getGmailConfigDiagnostics, isGmailConfigured, gmailConfig } from '../config/gmail.js';
import logger from '../utils/logger.js';
import {
  archiveMessage,
  buildGmailAuthUrl,
  buildSystemMailAuthUrl,
  deleteMessage,
  exchangeCodeForSystemMail,
  exchangeCodeForToken,
  getGmailStatus,
  getMessage,
  getSystemMailStatus,
  listMessages,
  markAsRead,
  replyToMessage,
  saveDraft,
  sendMessage,
  SYSTEM_MAIL_OAUTH_STATE
} from '../services/gmailService.js';

const frontendUrl = () => process.env.FRONTEND_URL || 'http://localhost:5173';

const router = Router();

router.get('/system-status', async (_req, res, next) => {
  try {
    res.json(await getSystemMailStatus());
  } catch (e) {
    next(e);
  }
});

/** Connect GMAIL_USER once so OTP / auth e-mails can be sent via Gmail API (no login required). */
router.get('/system-connect', (req, res, next) => {
  try {
    if (!isGmailConfigured()) {
      return res.status(503).send(
        'Configuration Gmail OAuth2 manquante. Définissez GMAIL_CLIENT_ID et GMAIL_CLIENT_SECRET dans backend/.env.'
      );
    }
    const cfg = gmailConfig();
    logger.info('Starting system mail Gmail OAuth', { user: cfg.user });
    res.redirect(buildSystemMailAuthUrl());
  } catch (e) {
    next(e);
  }
});

router.get('/callback', async (req, res, next) => {
  const frontend = frontendUrl();
  if (req.query.error) {
    if (req.query.state === SYSTEM_MAIL_OAUTH_STATE) {
      return res
        .status(400)
        .send(
          `Connexion mail système refusée: ${req.query.error}. Réessayez via /api/gmail/system-connect.`
        );
    }
    return res.redirect(`${frontend}/messaging?gmail_error=${encodeURIComponent(req.query.error)}`);
  }
  try {
    if (req.query.state === SYSTEM_MAIL_OAUTH_STATE) {
      const result = await exchangeCodeForSystemMail(req.query.code);
      return res
        .status(200)
        .type('html')
        .send(`<!DOCTYPE html><html lang="fr"><body style="font-family:system-ui;padding:2rem;background:#0f172a;color:#e2e8f0">
          <h1 style="color:#22c55e">Mail système connecté</h1>
          <p>Les e-mails OTP seront envoyés depuis <strong>${result.userEmail}</strong> via l’API Gmail.</p>
          <p>Vous pouvez fermer cet onglet et vous reconnecter sur M-ECAL.</p>
        </body></html>`);
    }
    await exchangeCodeForToken(req.query.code, req.query.state);
    res.redirect(`${frontend}/messaging?gmail=connected`);
  } catch (e) {
    console.error('Erreur callback Gmail:', e.message);
    if (req.query.state === SYSTEM_MAIL_OAUTH_STATE) {
      return res.status(500).send(`Échec connexion mail système: ${e.message}`);
    }
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
    try {
      const messages = await listMessages(req.userId, {
        maxResults: req.query.maxResults,
        labelIds: req.query.labelIds
      });
      res.json({ ...status, messages });
    } catch (e) {
      if (e.status === 401 || e.code === 'gmail_auth_expired') {
        return res.status(401).json({
          connected: false,
          configured: status.configured,
          userEmail: status.userEmail,
          messages: [],
          message: e.message || 'Session Gmail expirée. Reconnectez votre compte Gmail.'
        });
      }
      logger.warn('Gmail messages error', {
        status: e.status,
        message: e.message,
        detail: e.gmailDetail
      });
      return res.status(e.status || 502).json({
        ...status,
        messages: [],
        message: e.message || 'Impossible de charger les messages Gmail'
      });
    }
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
