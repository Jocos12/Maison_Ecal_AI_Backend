import { Router } from 'express';
import { authMiddleware, attachUser } from '../middleware/auth.js';
import User from '../models/User.js';
import bcrypt from 'bcryptjs';
import { sendTestNotification } from '../services/notificationService.js';
import { generateOtpDigits, hashOtp, verifyOtpHash } from '../utils/otp.utils.js';
import { sendOtpEmail, isEmailDeliveryConfigured } from '../services/email.service.js';
import { renewAuthCookie } from '../controllers/auth.controller.js';
import { authLimiter, passwordResetLimiter } from '../middleware/rateLimiter.js';
import logger from '../utils/logger.js';

const BCRYPT_ROUNDS = 12;
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const PHONE_PATTERN = /^\+\d{1,4}\s?\d{4,15}$/;
const EMAIL_OTP_TTL_MS = 10 * 60 * 1000;
const EMAIL_OTP_RESEND_MS = 60 * 1000;
const EMAIL_OTP_MAX_ATTEMPTS = 5;

const badRequest = (res, message, status = 400) => res.status(status).json({ message });

const router = Router();
router.use(authMiddleware);
router.use(attachUser);

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
    for (const k of [...allowed, 'phone', 'firstName', 'lastName']) {
      if (req.body[k] !== undefined) patch[k] = req.body[k];
    }
    if (patch.firstName !== undefined || patch.lastName !== undefined) {
      const current = await User.findById(req.userId).select('firstName lastName');
      const first = String(patch.firstName ?? current?.firstName ?? '').trim();
      const last = String(patch.lastName ?? current?.lastName ?? '').trim();
      if (first.length > 60 || last.length > 60) return badRequest(res, 'Prénom et nom : 60 caractères maximum.');
      patch.firstName = first;
      patch.lastName = last;
      if (first || last) patch.name = [first, last].filter(Boolean).join(' ');
    }
    if (patch.name !== undefined) {
      patch.name = String(patch.name).trim();
      if (patch.name.length < 2 || patch.name.length > 80) {
        return badRequest(res, 'Le nom doit contenir entre 2 et 80 caractères.');
      }
    }
    if (patch.phone !== undefined) {
      patch.phone = String(patch.phone).trim();
      if (patch.phone && !PHONE_PATTERN.test(patch.phone)) {
        return badRequest(res, 'Numéro de téléphone invalide (indicatif du pays puis chiffres).');
      }
    }
    const user = await User.findByIdAndUpdate(req.userId, patch, { new: true, runValidators: true }).select('-password');
    res.json(user);
  } catch (e) {
    next(e);
  }
});

router.put('/password', authLimiter, async (req, res, next) => {
  try {
    const { currentPassword, newPassword } = req.body || {};
    if (!currentPassword || !newPassword) return badRequest(res, 'Mot de passe actuel et nouveau mot de passe requis.');
    if (String(newPassword).length < 8) return badRequest(res, 'Le mot de passe doit contenir au moins 8 caractères.');
    const user = await User.findById(req.userId);
    if (!user) return badRequest(res, 'Compte introuvable.', 404);
    // 400 (not 401) on purpose: a wrong current password must not look like an expired session
    if (!(await bcrypt.compare(String(currentPassword), user.password))) {
      return badRequest(res, 'Le mot de passe actuel est incorrect.');
    }
    if (await bcrypt.compare(String(newPassword), user.password)) {
      return badRequest(res, 'Le nouveau mot de passe doit être différent de l’actuel.');
    }
    user.password = await bcrypt.hash(String(newPassword), BCRYPT_ROUNDS);
    await user.save();
    res.json({ ok: true });
  } catch (e) {
    next(e);
  }
});

/** Step 1 of an e-mail change: check the password, then send a code to the NEW address. */
router.post('/email/request', authLimiter, async (req, res, next) => {
  try {
    const email = String(req.body?.newEmail || '').toLowerCase().trim();
    const password = String(req.body?.password || '');
    if (!EMAIL_PATTERN.test(email)) return badRequest(res, 'Adresse e-mail invalide.');
    const user = await User.findById(req.userId);
    if (!user) return badRequest(res, 'Compte introuvable.', 404);
    if (!(await bcrypt.compare(password, user.password))) return badRequest(res, 'Le mot de passe est incorrect.');
    if (email === user.email) return badRequest(res, 'C’est déjà l’adresse de votre compte.');
    if (await User.exists({ email })) return badRequest(res, 'Cette adresse e-mail est déjà utilisée.', 409);

    // Without any e-mail delivery a code could never arrive: the password check is then the only safeguard
    if (!isEmailDeliveryConfigured()) {
      user.email = email;
      user.pendingEmail = null;
      await user.save();
      renewAuthCookie(res, user);
      return res.json({ changed: true, user });
    }

    if (user.pendingEmailSentAt && Date.now() - user.pendingEmailSentAt.getTime() < EMAIL_OTP_RESEND_MS) {
      return badRequest(res, 'Un code vient d’être envoyé. Patientez une minute avant d’en demander un autre.', 429);
    }
    const code = generateOtpDigits();
    try {
      await sendOtpEmail(email, code);
    } catch (e) {
      logger.error(`E-mail change code could not be delivered to ${email}: ${e.message}`);
      return badRequest(res, 'Impossible d’envoyer le code pour le moment. Réessayez plus tard.', 502);
    }
    user.pendingEmail = email;
    user.pendingEmailOtpHash = hashOtp(code);
    user.pendingEmailExpiresAt = new Date(Date.now() + EMAIL_OTP_TTL_MS);
    user.pendingEmailAttempts = 0;
    user.pendingEmailSentAt = new Date();
    await user.save();
    res.json({ changed: false, sentTo: email });
  } catch (e) {
    next(e);
  }
});

/** Step 2: the code received at the new address confirms the change. */
router.post('/email/confirm', passwordResetLimiter, async (req, res, next) => {
  try {
    const code = String(req.body?.code || '').trim();
    const user = await User.findById(req.userId);
    if (!user || !user.pendingEmail || !user.pendingEmailOtpHash) {
      return badRequest(res, 'Aucun changement d’adresse en attente.');
    }
    if (!user.pendingEmailExpiresAt || user.pendingEmailExpiresAt < new Date()) {
      return badRequest(res, 'Code expiré. Demandez un nouveau code.');
    }
    if (user.pendingEmailAttempts >= EMAIL_OTP_MAX_ATTEMPTS) {
      user.pendingEmail = null;
      user.pendingEmailOtpHash = null;
      await user.save();
      return badRequest(res, 'Trop d’essais. Recommencez le changement d’adresse.', 429);
    }
    if (!verifyOtpHash(code, user.pendingEmailOtpHash)) {
      user.pendingEmailAttempts += 1;
      await user.save();
      return badRequest(res, 'Code incorrect.');
    }
    if (await User.exists({ email: user.pendingEmail, _id: { $ne: user._id } })) {
      user.pendingEmail = null;
      user.pendingEmailOtpHash = null;
      await user.save();
      return badRequest(res, 'Cette adresse e-mail est déjà utilisée.', 409);
    }
    user.email = user.pendingEmail;
    user.pendingEmail = null;
    user.pendingEmailOtpHash = null;
    user.pendingEmailExpiresAt = null;
    user.pendingEmailAttempts = 0;
    await user.save();
    renewAuthCookie(res, user);
    res.json({ changed: true, user });
  } catch (e) {
    next(e);
  }
});

router.delete('/email/pending', async (req, res, next) => {
  try {
    const user = await User.findByIdAndUpdate(
      req.userId,
      { pendingEmail: null, pendingEmailOtpHash: null, pendingEmailExpiresAt: null, pendingEmailAttempts: 0 },
      { new: true }
    ).select('-password');
    res.json(user);
  } catch (e) {
    next(e);
  }
});

const AVATAR_PATTERN = /^data:image\/(png|jpeg|webp);base64,[A-Za-z0-9+/=]+$/;
const AVATAR_MAX_CHARS = 400_000;

router.put('/avatar', async (req, res, next) => {
  try {
    const image = String(req.body?.image || '');
    if (!AVATAR_PATTERN.test(image)) {
      return res.status(400).json({ message: 'Image invalide (PNG, JPEG ou WebP).' });
    }
    if (image.length > AVATAR_MAX_CHARS) {
      return res.status(413).json({ message: 'Image trop lourde.' });
    }
    const user = await User.findByIdAndUpdate(req.userId, { avatar: image }, { new: true }).select('-password');
    res.json(user);
  } catch (e) {
    next(e);
  }
});

router.delete('/avatar', async (req, res, next) => {
  try {
    const user = await User.findByIdAndUpdate(req.userId, { avatar: '' }, { new: true }).select('-password');
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
