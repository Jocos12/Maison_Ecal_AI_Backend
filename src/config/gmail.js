export const GMAIL_SCOPES = [
  'https://www.googleapis.com/auth/gmail.readonly',
  'https://www.googleapis.com/auth/gmail.send',
  'https://www.googleapis.com/auth/gmail.modify',
  'https://www.googleapis.com/auth/gmail.compose'
];

function cleanEnv(value) {
  if (value == null) return '';
  return String(value).trim().replace(/^['"]|['"]$/g, '');
}

const PLACEHOLDER_PREFIXES = ['REMPLACER_', 'your_', 'xxx', 'changeme', 'placeholder'];

function isPlaceholder(value) {
  const v = cleanEnv(value);
  if (!v) return true;
  const lower = v.toLowerCase();
  return PLACEHOLDER_PREFIXES.some((p) => lower.startsWith(p.toLowerCase()));
}

export function gmailConfig() {
  return {
    clientId: cleanEnv(process.env.GMAIL_CLIENT_ID),
    clientSecret: cleanEnv(process.env.GMAIL_CLIENT_SECRET),
    redirectUri:
      cleanEnv(process.env.GMAIL_REDIRECT_URI) || 'http://localhost:5000/api/gmail/callback',
    user: cleanEnv(process.env.GMAIL_USER) || 'maisonecal@gmail.com',
    tlsRejectUnauthorized: cleanEnv(process.env.GMAIL_TLS_REJECT_UNAUTHORIZED) !== 'false'
  };
}

export function getGmailConfigDiagnostics() {
  const cfg = gmailConfig();
  return {
    clientId: cfg.clientId ? (isPlaceholder(cfg.clientId) ? 'placeholder' : 'set') : 'missing',
    clientSecret: cfg.clientSecret ? (isPlaceholder(cfg.clientSecret) ? 'placeholder' : 'set') : 'missing',
    redirectUri: cfg.redirectUri ? 'set' : 'missing',
    user: cfg.user ? 'set' : 'missing',
    tlsRejectUnauthorized: cfg.tlsRejectUnauthorized,
    envFileHint: 'Place credentials in backend/.env (not frontend/.env)'
  };
}

export function isGmailConfigured() {
  const cfg = gmailConfig();
  return Boolean(
    cfg.clientId &&
      cfg.clientSecret &&
      cfg.redirectUri &&
      !isPlaceholder(cfg.clientId) &&
      !isPlaceholder(cfg.clientSecret)
  );
}
