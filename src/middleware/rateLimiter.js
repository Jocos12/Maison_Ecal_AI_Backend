import rateLimit from 'express-rate-limit';

function skipInDevelopment(_req, _res, next) {
  next();
}

/** Spec: max 5 requests / 15 min per IP on auth routes */
export const authLimiter =
  process.env.NODE_ENV === 'development'
    ? skipInDevelopment
    : rateLimit({
        windowMs: 15 * 60 * 1000,
        max: 5,
        standardHeaders: true,
        legacyHeaders: false,
        message: { message: 'Trop de requêtes. Réessayez dans 15 minutes.' }
      });

/** 1 scan HTTP accepté / 25 min, toutes IPs confondues (planificateur externe 30 min). */
export const internalScrapeLimiter = rateLimit({
  windowMs: Number(process.env.SCRAPE_SAFETY_NET_MS || 25 * 60 * 1000),
  max: 1,
  standardHeaders: true,
  legacyHeaders: false,
  skipFailedRequests: true,
  keyGenerator: () => 'internal-scrape',
  validate: { default: false },
  message: { message: 'Scan déjà déclenché récemment. Réessayez dans 25 minutes.' },
  handler: (req, res) => {
    res.status(429).json({ message: 'Scan déjà déclenché récemment. Réessayez dans 25 minutes.' });
  }
});
