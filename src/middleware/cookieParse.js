/**
 * Minimal Cookie header parser (no dependency) — same shape as cookie-parser's req.cookies.
 */
export function parseCookies(req) {
  const out = {};
  const raw = req.headers.cookie;
  if (!raw || typeof raw !== 'string') return out;
  for (const part of raw.split(';')) {
    const idx = part.indexOf('=');
    if (idx === -1) continue;
    const k = part.slice(0, idx).trim();
    const v = part.slice(idx + 1).trim();
    if (!k) continue;
    try {
      out[decodeURIComponent(k)] = decodeURIComponent(v);
    } catch {
      out[k] = v;
    }
  }
  return out;
}

export function cookieParserMiddleware(req, _res, next) {
  req.cookies = parseCookies(req);
  next();
}
