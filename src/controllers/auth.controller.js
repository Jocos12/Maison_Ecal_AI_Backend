import jwt from 'jsonwebtoken';
import bcrypt from 'bcryptjs';
import User from '../models/User.js';
import { generateOtpDigits, hashOtp, verifyOtpHash } from '../utils/otp.utils.js';
import {
  generateResetKeyAndRawToken,
  hashResetToken,
  verifyResetTokenHash
} from '../utils/resetToken.utils.js';
import {
  sendOtpEmail,
  sendWelcomeEmail,
  sendPasswordResetEmail,
  sendAdminNewSignupEmail,
  sendAccountApprovedEmail,
  isSmtpConfigured
} from '../services/email.service.js';
import logger from '../utils/logger.js';
import { AUTH_COOKIE_NAME } from '../config/auth.constants.js';
import { recordLoginActivity } from '../services/loginActivityService.js';

const JWT_EXPIRES = process.env.JWT_EXPIRES_IN || '24h';
const BCRYPT_ROUNDS = 12;

function cookieOptions() {
  return {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    maxAge: 24 * 60 * 60 * 1000,
    path: '/'
  };
}

function signJwt(user) {
  return jwt.sign(
    { sub: user._id.toString(), email: user.email, role: user.role },
    process.env.JWT_SECRET,
    { expiresIn: JWT_EXPIRES }
  );
}

function setAuthCookie(res, token) {
  res.cookie(AUTH_COOKIE_NAME, token, cookieOptions());
}

function clearAuthCookie(res) {
  res.clearCookie(AUTH_COOKIE_NAME, {
    path: '/',
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production'
  });
}

function publicUser(user) {
  return {
    id: user._id,
    name: user.name,
    email: user.email,
    role: user.role,
    isVerified: user.isVerified,
    isApproved: isUserApproved(user),
    alertsEnabled: user.alertsEnabled,
    alertFrequency: user.alertFrequency,
    keywords: user.keywords,
    whatsappNumber: user.whatsappNumber,
    digestEmail: user.digestEmail,
    preferredLanguage: user.preferredLanguage
  };
}

function isUserApproved(user) {
  if (!user) return false;
  if (user.isApproved === true) return true;
  if (user.isApproved === false) return false;
  return user.isVerified === true || ['Admin', 'admin'].includes(user.role);
}

function pendingApprovalResponse(res, user) {
  return res.status(403).json({
    code: 'PENDING_APPROVAL',
    requiresApproval: true,
    email: user.email,
    message:
      'Votre compte est en attente de validation par un administrateur M-ECAL. Vous recevrez l’accès après approbation.'
  });
}

function shouldRequireOtp() {
  if (process.env.AUTH_REQUIRE_OTP === 'false') return false;
  return isSmtpConfigured();
}

async function sendOtpOrFail(email, otp) {
  try {
    await sendOtpEmail(email, otp);
  } catch (e) {
    logger.error(`OTP email delivery failed for ${email}: ${e.message}`);
    const err = new Error(
      "Impossible d'envoyer le code OTP pour le moment. Vérifiez la configuration SMTP puis réessayez."
    );
    err.status = 502;
    throw err;
  }
}

async function sendPasswordResetOrFail(email, resetUrl) {
  const result = await sendPasswordResetEmail(email, resetUrl);
  if (!result.sent) {
    throw new Error('SMTP non configuré');
  }
}

export async function getMe(req, res, next) {
  try {
    if (!req.userId) {
      return res.json(null);
    }
    const user = await User.findById(req.userId).select('-password');
    if (!user) {
      return res.json(null);
    }
    res.json(user);
  } catch (e) {
    next(e);
  }
}

export async function signup(req, res, next) {
  try {
    const { name, email, password, confirmPassword, role } = req.body || {};
    if (!name || !email || !password) {
      return res.status(400).json({ message: 'Champs requis manquants.' });
    }
    if (password !== confirmPassword) {
      return res.status(400).json({ message: 'Les mots de passe ne correspondent pas.' });
    }
    if (password.length < 8) {
      return res.status(400).json({ message: 'Le mot de passe doit contenir au moins 8 caractères.' });
    }
    const allowedRoles = ['Analyste', 'Manager'];
    const r = allowedRoles.includes(role) ? role : 'Analyste';

    const exists = await User.findOne({ email: String(email).toLowerCase().trim() });
    if (exists) {
      return res.status(409).json({ message: 'Cette adresse e-mail est déjà utilisée.' });
    }

    const hash = await bcrypt.hash(password, BCRYPT_ROUNDS);
    const user = await User.create({
      name: String(name).trim(),
      email: String(email).toLowerCase().trim(),
      password: hash,
      role: r,
      isVerified: false,
      isApproved: false
    });

    const otp = generateOtpDigits();
    user.assignOtp(hashOtp(otp));
    await user.save();

    sendAdminNewSignupEmail({
      name: user.name,
      email: user.email,
      role: user.role,
      createdAt: user.createdAt
    }).catch((e) => logger.warn(`Admin signup notify failed: ${e.message}`));

    if (isSmtpConfigured()) {
      await sendWelcomeEmail(user.email, user.name, { pendingApproval: true }).catch((e) =>
        logger.warn(e.message)
      );
      await sendOtpOrFail(user.email, otp);
      return res.status(201).json({
        requiresOtp: true,
        requiresApproval: true,
        email: user.email,
        message:
          'Compte créé. Vérifiez votre e-mail avec le code OTP, puis attendez la validation d’un administrateur.'
      });
    }

    user.isVerified = true;
    user.clearOtp();
    await user.save();
    return res.status(201).json({
      requiresOtp: false,
      requiresApproval: true,
      email: user.email,
      message:
        'Compte créé. Un administrateur M-ECAL doit valider votre inscription avant la première connexion.'
    });
  } catch (e) {
    next(e);
  }
}

export async function login(req, res, next) {
  try {
    const { email, password } = req.body || {};
    if (!email || !password) {
      return res.status(400).json({ message: 'E-mail et mot de passe requis.' });
    }
    const user = await User.findOne({ email: String(email).toLowerCase().trim() });
    if (!user) {
      return res.status(401).json({ message: 'Identifiants invalides.' });
    }
    const ok = await bcrypt.compare(password, user.password);
    if (!ok) {
      return res.status(401).json({ message: 'Identifiants invalides.' });
    }

    if (!shouldRequireOtp()) {
      if (!isUserApproved(user)) {
        return pendingApprovalResponse(res, user);
      }
      const token = signJwt(user);
      setAuthCookie(res, token);
      await recordLoginActivity(req, user, 'login').catch((e) =>
        logger.warn(`Login activity log failed: ${e.message}`)
      );
      return res.json({ requiresOtp: false, user: publicUser(user) });
    }

    if (!isUserApproved(user)) {
      return pendingApprovalResponse(res, user);
    }

    const otp = generateOtpDigits();
    user.assignOtp(hashOtp(otp));
    await user.save();
    await sendOtpOrFail(user.email, otp);
    return res.json({ requiresOtp: true, email: user.email });
  } catch (e) {
    next(e);
  }
}

export async function verifyOtp(req, res, next) {
  try {
    const { email, code } = req.body || {};
    if (!email || !code) {
      return res.status(400).json({ message: 'E-mail et code requis.' });
    }
    const user = await User.findOne({ email: String(email).toLowerCase().trim() });
    if (!user || !user.otpHash) {
      return res.status(400).json({ message: 'Code invalide ou expiré.' });
    }
    if (!user.otpExpiresAt || user.otpExpiresAt < new Date()) {
      return res.status(400).json({ message: 'Code expiré. Demandez un nouveau code.' });
    }
    if (!verifyOtpHash(String(code).trim(), user.otpHash)) {
      return res.status(400).json({ message: 'Code incorrect.' });
    }

    user.isVerified = true;
    user.clearOtp();
    await user.save();

    if (!isUserApproved(user)) {
      return res.status(403).json({
        code: 'PENDING_APPROVAL',
        requiresApproval: true,
        email: user.email,
        message:
          'E-mail vérifié. Votre compte attend la validation d’un administrateur M-ECAL avant la connexion.'
      });
    }

    const token = signJwt(user);
    setAuthCookie(res, token);
    await recordLoginActivity(req, user, 'login').catch((e) =>
      logger.warn(`Login activity log failed: ${e.message}`)
    );
    return res.json({ user: publicUser(user) });
  } catch (e) {
    next(e);
  }
}

export async function resendOtp(req, res, next) {
  try {
    const { email } = req.body || {};
    if (!email) return res.status(400).json({ message: 'E-mail requis.' });
    const user = await User.findOne({ email: String(email).toLowerCase().trim() });
    if (!user) {
      return res.json({ ok: true });
    }
    const now = Date.now();
    if (user.lastOtpSentAt && now - new Date(user.lastOtpSentAt).getTime() < 60_000) {
      const wait = Math.ceil(60 - (now - new Date(user.lastOtpSentAt).getTime()) / 1000);
      return res.status(429).json({ message: `Patientez ${wait}s avant de renvoyer.` });
    }
    if (!isSmtpConfigured()) {
      return res.status(503).json({ message: 'Envoi d’e-mail non configuré.' });
    }
    const otp = generateOtpDigits();
    user.assignOtp(hashOtp(otp));
    await user.save();
    await sendOtpOrFail(user.email, otp);
    return res.json({ ok: true });
  } catch (e) {
    next(e);
  }
}

export async function forgotPassword(req, res, next) {
  try {
    const { email } = req.body || {};
    const msg = {
      message:
        'Si cette adresse existe dans notre système, vous recevrez un lien de réinitialisation sous peu.'
    };
    if (!email) {
      return res.json(msg);
    }

    const normalizedEmail = String(email).toLowerCase().trim();
    const user = await User.findOne({ email: normalizedEmail });
    if (!user) {
      logger.info(`Forgot password requested for unknown email: ${normalizedEmail}`);
      return res.json(msg);
    }

    if (!isSmtpConfigured()) {
      logger.warn('Forgot password: SMTP not configured');
      return res.json(msg);
    }

    const { key, rawToken } = generateResetKeyAndRawToken();
    user.setPasswordReset(key, hashResetToken(rawToken));
    await user.save();

    const base = (process.env.FRONTEND_URL || 'http://localhost:5173').replace(/\/$/, '');
    const resetUrl = `${base}/reset-password?key=${encodeURIComponent(key)}&token=${encodeURIComponent(rawToken)}`;

    try {
      await sendPasswordResetOrFail(user.email, resetUrl);
      logger.info(`Password reset email sent to ${user.email}`);
    } catch (e) {
      user.clearPasswordReset();
      await user.save();
      logger.error(`Password reset email failed for ${user.email}: ${e.message}`);
      if (process.env.NODE_ENV === 'development') {
        logger.warn(`[DEV] Lien de réinitialisation (email non envoyé): ${resetUrl}`);
      }
    }

    return res.json(msg);
  } catch (e) {
    next(e);
  }
}

export async function resetPassword(req, res, next) {
  try {
    const { key, token, password, confirmPassword } = req.body || {};
    if (!key || !token || !password) {
      return res.status(400).json({ message: 'Données invalides.' });
    }
    if (password !== confirmPassword) {
      return res.status(400).json({ message: 'Les mots de passe ne correspondent pas.' });
    }
    if (password.length < 8) {
      return res.status(400).json({ message: 'Mot de passe trop court (8 caractères minimum).' });
    }
    const user = await User.findOne({ passwordResetKey: String(key) });
    if (
      !user ||
      !user.passwordResetTokenHash ||
      !user.passwordResetExpires ||
      user.passwordResetExpires < new Date()
    ) {
      return res.status(400).json({ message: 'Lien invalide ou expiré.' });
    }
    if (!verifyResetTokenHash(String(token), user.passwordResetTokenHash)) {
      return res.status(400).json({ message: 'Lien invalide ou expiré.' });
    }
    user.password = await bcrypt.hash(password, BCRYPT_ROUNDS);
    user.clearPasswordReset();
    await user.save();
    clearAuthCookie(res);
    return res.json({ message: 'Mot de passe mis à jour.' });
  } catch (e) {
    next(e);
  }
}

export async function logout(req, res, next) {
  try {
    let actor = req.user;
    if (!actor && req.userId) {
      actor = await User.findById(req.userId);
    }
    if (actor) {
      await recordLoginActivity(req, actor, 'logout').catch(() => {});
    }
    clearAuthCookie(res);
    res.json({ ok: true });
  } catch (e) {
    next(e);
  }
}
