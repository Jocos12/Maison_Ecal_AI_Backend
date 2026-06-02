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
