import crypto from 'crypto';

const PEPPER = () => process.env.OTP_PEPPER || process.env.JWT_SECRET || 'mecal-dev-pepper';

/** 6-digit string */
export function generateOtpDigits() {
  return String(crypto.randomInt(0, 1_000_000)).padStart(6, '0');
}

export function hashOtp(otp) {
  return crypto.createHash('sha256').update(`${PEPPER()}:otp:${otp}`).digest('hex');
}

export function verifyOtpHash(plainOtp, storedHash) {
  if (!plainOtp || !storedHash) return false;
  const a = Buffer.from(hashOtp(plainOtp), 'hex');
  const b = Buffer.from(storedHash, 'hex');
  if (a.length !== b.length) return false;
  return crypto.timingSafeEqual(a, b);
}
