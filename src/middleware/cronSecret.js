import logger from '../utils/logger.js';
import { bearerToken, timingSafeEqualString } from '../utils/timingSafeSecret.js';

const WINDOW_MS = 10 * 60 * 1000;
const BRUTE_FORCE_THRESHOLD = 5;
const hitsByIp = new Map();

function clientIp(req) {
  const forwarded = req.get('x-forwarded-for');
  if (forwarded) return forwarded.split(',')[0].trim();
  return req.ip || req.socket?.remoteAddress || 'unknown';
}

function noteInvalidAttempt(ip) {
  const now = Date.now();
  const prev = (hitsByIp.get(ip) || []).filter((t) => now - t < WINDOW_MS);
  prev.push(now);
  hitsByIp.set(ip, prev);
  return prev.length;
}

/**
 * Authorization: Bearer <CRON_SECRET> only.
 * No query, body, or x-cron-secret fallback.
 */
export function requireCronBearer(req, res, next) {
  const secret = process.env.CRON_SECRET?.trim() || '';
  const token = bearerToken(req);
  const ip = clientIp(req);
  const ua = req.get('user-agent') || '';

  if (!secret || !timingSafeEqualString(token, secret)) {
    const count = noteInvalidAttempt(ip);
    logger.warn('CRON_SECRET rejeté sur POST /api/internal/scrape', {
      ip,
      userAgent: ua,
      timestamp: new Date().toISOString(),
      attemptsIn10min: count
    });
    if (count >= BRUTE_FORCE_THRESHOLD) {
      logger.error('Possible tentative de force brute sur CRON_SECRET', {
        ip,
        attemptsIn10min: count,
        timestamp: new Date().toISOString()
      });
    }
    return res.status(401).json({ message: 'Unauthorized' });
  }

  next();
}
