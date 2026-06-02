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
  isSmtpConfigured
} from '../services/email.service.js';
import logger from '../utils/logger.js';
import { AUTH_COOKIE_NAME } from '../config/auth.constants.js';

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
    alertsEnabled: user.alertsEnabled,
    alertFrequency: user.alertFrequency,
    keywords: user.keywords,
    whatsappNumber: user.whatsappNumber,
    digestEmail: user.digestEmail,
    preferredLanguage: user.preferredLanguage
  };
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
    const allowedRoles = ['Analyste', 'Manager', 'Admin'];
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
      isVerified: false
    });

    const otp = generateOtpDigits();
    user.assignOtp(hashOtp(otp));
    await user.save();

    if (isSmtpConfigured()) {
      await sendWelcomeEmail(user.email, user.name).catch((e) => logger.warn(e.message));
      await sendOtpOrFail(user.email, otp);
      return res.status(201).json({ requiresOtp: true, email: user.email });
    }

    // Dev: pas d’e-mail → vérifier et connecter directement
    user.isVerified = true;
    user.clearOtp();
    await user.save();
    const token = signJwt(user);
    setAuthCookie(res, token);
    return res.status(201).json({ requiresOtp: false, user: publicUser(user) });
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

    if (!isSmtpConfigured()) {
      const token = signJwt(user);
      setAuthCookie(res, token);
      return res.json({ requiresOtp: false, user: publicUser(user) });
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

    const token = signJwt(user);
    setAuthCookie(res, token);
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
    const user = await User.findOne({ email: String(email).toLowerCase().trim() });
    if (!user || !isSmtpConfigured()) {
      return res.json(msg);
    }
    const { key, rawToken } = generateResetKeyAndRawToken();
    user.setPasswordReset(key, hashResetToken(rawToken));
    await user.save();
    const base = (process.env.FRONTEND_URL || 'http://localhost:5173').replace(/\/$/, '');
    const resetUrl = `${base}/reset-password?key=${encodeURIComponent(key)}&token=${encodeURIComponent(rawToken)}`;
    await sendPasswordResetEmail(user.email, resetUrl).catch((e) => logger.warn(e.message));
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
    return res.json({ message: 'Mot de passe mis à jour.' });
  } catch (e) {
    next(e);
  }
}

export async function logout(_req, res, next) {
  try {
    clearAuthCookie(res);
    res.json({ ok: true });
  } catch (e) {
    next(e);
  }
}
