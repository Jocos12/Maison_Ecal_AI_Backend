import jwt from 'jsonwebtoken';
import User from '../models/User.js';
import { AUTH_COOKIE_NAME } from '../config/auth.constants.js';

export function authMiddleware(req, res, next) {
  const cookieToken = req.cookies?.[AUTH_COOKIE_NAME];
  const header = req.headers.authorization;
  const bearer =
    header?.startsWith('Bearer ') ? header.slice(7) : null;
  const token = cookieToken || bearer;
  if (!token) {
    return res.status(401).json({ message: 'Unauthorized' });
  }
  try {
    const payload = jwt.verify(token, process.env.JWT_SECRET);
    req.userId = payload.sub;
    req.userEmail = payload.email;
    req.userRole = payload.role;
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
