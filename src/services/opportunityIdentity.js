import crypto from 'crypto';

export function normalizeSourceUrl(raw) {
  if (!raw) return '';
  try {
    const u = new URL(String(raw).trim());
    u.hash = '';
    u.hostname = u.hostname.toLowerCase();
    if (u.pathname.length > 1) u.pathname = u.pathname.replace(/\/+$/, '');
    const drop = [...u.searchParams.keys()].filter((k) =>
      /^(utm_|fbclid|gclid|mc_|ref$|_ga)/i.test(k)
    );
    drop.forEach((k) => u.searchParams.delete(k));
    u.searchParams.sort();
    return u.toString();
  } catch {
    return String(raw).trim().replace(/\/+$/, '');
  }
}

export function normalizeTitle(title) {
  return String(title || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
    .slice(0, 180);
}

export function opportunityFingerprint(sourceUrl, title) {
  const key = `${normalizeSourceUrl(sourceUrl)}|${normalizeTitle(title)}`;
  return crypto.createHash('sha256').update(key).digest('hex');
}
