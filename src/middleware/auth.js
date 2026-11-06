import jwt from 'jsonwebtoken';
import User from '../models/User.js';
import { AUTH_COOKIE_NAME } from '../config/auth.constants.js';

function readAuthToken(req) {
  const cookieToken = req.cookies?.[AUTH_COOKIE_NAME];
  const header = req.headers.authorization;
  const bearer = header?.startsWith('Bearer ') ? header.slice(7) : null;
  return cookieToken || bearer || null;
}

function attachAuthPayload(req, token) {
  const payload = jwt.verify(token, process.env.JWT_SECRET);
  req.userId = payload.sub;
  req.userEmail = payload.email;
  req.userRole = payload.role;
}

export function optionalAuthMiddleware(req, res, next) {
  const token = readAuthToken(req);
  if (!token) return next();
  try {
    attachAuthPayload(req, token);
  } catch {
    // Token invalide ou expiré : traiter comme visiteur non connecté.
  }
  next();
}

export function authMiddleware(req, res, next) {
  const token = readAuthToken(req);
  if (!token) {
    return res.status(401).json({ message: 'Unauthorized' });
  }
  try {
    attachAuthPayload(req, token);
    next();
  } catch {
    return res.status(401).json({ message: 'Invalid or expired token' });
  }
}

export async function attachUser(req, res, next) {
  if (!req.userId) return next();
  try {
    req.user = await User.findById(req.userId).select('-password');
  } catch {
    req.user = null;
  }
  next();
}

/**
 * À placer après authMiddleware + attachUser sur les routes protégées.
 * Refuse l'accès si le compte a été supprimé ou n'est plus approuvé, et
 * aligne req.userRole sur le rôle ACTUEL en base (un changement de rôle ou une
 * suppression prend effet immédiatement, sans attendre l'expiration du jeton).
 */
export function requireActiveUser(req, res, next) {
  if (!req.user) {
    return res.status(401).json({ message: 'Session invalide. Veuillez vous reconnecter.' });
  }
  if (req.user.isApproved === false) {
    return res.status(403).json({ message: 'Compte en attente de validation.' });
  }
  req.userRole = req.user.role;
  req.userEmail = req.user.email;
  next();
}
