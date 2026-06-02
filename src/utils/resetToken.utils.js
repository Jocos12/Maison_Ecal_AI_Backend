import crypto from 'crypto';

const PEPPER = () => process.env.RESET_TOKEN_PEPPER || process.env.JWT_SECRET || 'mecal-dev-reset';

/** Opaque key for DB lookup (stored in plain) + raw token for URL (never stored plain). */
export function generateResetKeyAndRawToken() {
  const key = crypto.randomBytes(16).toString('hex');
  const rawToken = crypto.randomBytes(32).toString('hex');
  return { key, rawToken };
}

export function hashResetToken(rawToken) {
  return crypto.createHash('sha256').update(`${PEPPER()}:reset:${rawToken}`).digest('hex');
}

export function verifyResetTokenHash(rawToken, storedHash) {
  if (!rawToken || !storedHash) return false;
  const a = Buffer.from(hashResetToken(rawToken), 'hex');
  const b = Buffer.from(storedHash, 'hex');
  if (a.length !== b.length) return false;
  return crypto.timingSafeEqual(a, b);
}
