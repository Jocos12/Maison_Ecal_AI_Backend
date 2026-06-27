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
