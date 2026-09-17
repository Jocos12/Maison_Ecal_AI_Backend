import mongoose from 'mongoose';
import GmailToken from '../models/GmailToken.js';
import SystemSetting from '../models/SystemSetting.js';
import {
  GMAIL_SCOPES,
  getGmailConfigDiagnostics,
  gmailConfig,
  isGmailConfigured
} from '../config/gmail.js';
import { createOAuth2Client, gmailApiRequest } from './gmailOAuth.js';
import logger from '../utils/logger.js';

export const SYSTEM_MAIL_OAUTH_STATE = 'system-mail';
const SYSTEM_MAIL_SETTING_KEY = 'gmail_system_mail';

function assertGmailConfigured() {
  if (isGmailConfigured()) return;
  const err = new Error(
    'Configuration Gmail OAuth2 manquante. Renseignez GMAIL_CLIENT_ID et GMAIL_CLIENT_SECRET dans backend/.env.'
  );
  err.status = 503;
  err.diagnostics = getGmailConfigDiagnostics();
  throw err;
}

export { createOAuth2Client };

export function buildGmailAuthUrl(userId) {
  assertGmailConfigured();
  const oauth2 = createOAuth2Client();
  return oauth2.generateAuthUrl({
    access_type: 'offline',
    scope: GMAIL_SCOPES,
    prompt: 'consent',
    state: String(userId || '')
  });
}

/** One-time OAuth for system auth e-mails (OTP, reset, welcome). No login required. */
export function buildSystemMailAuthUrl() {
  return buildGmailAuthUrl(SYSTEM_MAIL_OAUTH_STATE);
}

function cleanRefreshToken(value) {
  if (value == null) return '';
  return String(value).trim().replace(/^['"]|['"]$/g, '');
}

async function loadSystemMailCredentials() {
  const cfg = gmailConfig();
  const envRefresh = cleanRefreshToken(process.env.GMAIL_REFRESH_TOKEN);
  if (envRefresh) {
    return {
      source: 'env',
      userEmail: cfg.user,
      credentials: { refresh_token: envRefresh }
    };
  }

  const setting = await SystemSetting.findOne({ key: SYSTEM_MAIL_SETTING_KEY }).lean();
  const stored = setting?.value || {};
  const refresh =
    cleanRefreshToken(stored.refresh_token) || cleanRefreshToken(stored.refreshToken);
  const access = cleanRefreshToken(stored.access_token) || cleanRefreshToken(stored.accessToken);
  if (refresh || access) {
    return {
      source: 'system_setting',
      userEmail: stored.userEmail || cfg.user,
      credentials: {
        access_token: access || undefined,
        refresh_token: refresh || undefined,
        scope: stored.scope,
        token_type: stored.token_type || stored.tokenType,
        expiry_date: stored.expiry_date || stored.expiryDate
      }
    };
  }

  const tokenDoc = await GmailToken.findOne({
    userEmail: new RegExp(`^${cfg.user.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`, 'i')
  })
    .sort({ updatedAt: -1 })
    .lean();
  if (tokenDoc) {
    return {
      source: 'gmail_token',
      userId: tokenDoc.userId,
      userEmail: tokenDoc.userEmail || cfg.user,
      credentials: tokenDocToCredentials(tokenDoc)
    };
  }

  return null;
}

export async function isSystemMailReady() {
  if (!isGmailConfigured()) return false;
  const creds = await loadSystemMailCredentials();
  return Boolean(creds?.credentials?.refresh_token || creds?.credentials?.access_token);
}

export async function getSystemMailStatus() {
  const configured = isGmailConfigured();
  const cfg = gmailConfig();
  if (!configured) {
    return { configured: false, connected: false, userEmail: cfg.user, connectPath: null };
  }
  const ready = await isSystemMailReady();
  return {
    configured: true,
    connected: ready,
    userEmail: cfg.user,
    connectPath: '/api/gmail/system-connect'
  };
}

export async function exchangeCodeForSystemMail(code) {
  if (!code) throw Object.assign(new Error('Code OAuth Gmail manquant.'), { status: 400 });
  assertGmailConfigured();
  const tokens = await getTokensFromCode(code);
  const cfg = gmailConfig();
  const existing = await SystemSetting.findOne({ key: SYSTEM_MAIL_SETTING_KEY }).lean();
  const prev = existing?.value || {};
  const refresh_token = tokens.refresh_token || prev.refresh_token || prev.refreshToken;
  if (!refresh_token) {
    throw Object.assign(
      new Error(
        'Aucun refresh_token reçu. Réessayez en révoquant l’accès M-ECAL sur https://myaccount.google.com/permissions puis reconnectez.'
      ),
      { status: 400 }
    );
  }
  const value = {
    userEmail: cfg.user,
    access_token: tokens.access_token,
    refresh_token,
    scope: tokens.scope,
    token_type: tokens.token_type,
    expiry_date: tokens.expiry_date,
    connectedAt: new Date().toISOString()
  };
  await SystemSetting.findOneAndUpdate(
    { key: SYSTEM_MAIL_SETTING_KEY },
    { $set: { value } },
    { upsert: true, new: true }
  );
  logger.info('System mail Gmail OAuth connected', { userEmail: cfg.user });
  return { userEmail: cfg.user };
}

async function getSystemMailClient() {
  assertGmailConfigured();
  const loaded = await loadSystemMailCredentials();
  if (!loaded) {
    throw Object.assign(
      new Error(
        'Mail système Gmail non connecté. Ouvrez /api/gmail/system-connect avec le compte GMAIL_USER.'
      ),
      { status: 503, code: 'gmail_system_not_connected' }
    );
  }
  if (loaded.userId) {
    return getAuthenticatedClient(loaded.userId);
  }
  const oauth2 = createOAuth2Client();
  oauth2.setCredentials(loaded.credentials);
  oauth2.on('tokens', async (newTokens) => {
    if (loaded.source !== 'system_setting') return;
    const existing = await SystemSetting.findOne({ key: SYSTEM_MAIL_SETTING_KEY }).lean();
    const prev = existing?.value || {};
    await SystemSetting.findOneAndUpdate(
      { key: SYSTEM_MAIL_SETTING_KEY },
      {
        $set: {
          value: {
            ...prev,
            access_token: newTokens.access_token || prev.access_token,
            refresh_token: newTokens.refresh_token || prev.refresh_token || prev.refreshToken,
            expiry_date: newTokens.expiry_date || prev.expiry_date,
            scope: newTokens.scope || prev.scope,
            token_type: newTokens.token_type || prev.token_type
          }
        }
      },
      { upsert: true }
    );
  });
  return oauth2;
}

/** Send HTML mail via Gmail API (works when SMTP App Password is rejected). */
export async function sendSystemHtmlEmail({ to, subject, html }) {
  const cfg = gmailConfig();
  const oauth2 = await getSystemMailClient();
  const raw = encodeRawEmail([
    `From: M-ECAL <${cfg.user}>`,
    `To: ${to}`,
    `Subject: ${subject}`,
    'MIME-Version: 1.0',
    'Content-Type: text/html; charset=utf-8',
    '',
    html
  ]);
  return gmailApiRequest(oauth2, 'post', '/users/me/messages/send', { data: { raw } });
}

export async function getTokensFromCode(code) {
  if (!code) throw Object.assign(new Error('Code OAuth Gmail manquant.'), { status: 400 });
  assertGmailConfigured();
  const oauth2 = createOAuth2Client();
  const { tokens } = await oauth2.getToken(code);
  return tokens;
}

export async function exchangeCodeForToken(code, userId) {
  if (!userId || !mongoose.Types.ObjectId.isValid(userId)) {
    throw Object.assign(new Error('Utilisateur OAuth Gmail invalide.'), { status: 400 });
  }
  const tokens = await getTokensFromCode(code);
  const cfg = gmailConfig();
  const existing = await GmailToken.findOne({ userId });
  await GmailToken.findOneAndUpdate(
    { userId },
    {
      $set: {
        userEmail: cfg.user,
        accessToken: tokens.access_token,
        refreshToken: tokens.refresh_token || existing?.refreshToken,
        scope: tokens.scope,
        tokenType: tokens.token_type,
        expiryDate: tokens.expiry_date ? new Date(tokens.expiry_date) : new Date(Date.now() + 3600_000),
        tokens
      }
    },
    { upsert: true, new: true }
  );
}

function tokenDocToCredentials(doc) {
  if (doc.tokens?.access_token) return doc.tokens;
  return {
    access_token: doc.accessToken,
    refresh_token: doc.refreshToken,
    scope: doc.scope,
    token_type: doc.tokenType,
    expiry_date: doc.expiryDate ? doc.expiryDate.getTime() : undefined
  };
}

export async function getAuthenticatedClient(userId) {
  const tokenDoc = await GmailToken.findOne({ userId });
  if (!tokenDoc) throw Object.assign(new Error('Gmail non connecté.'), { status: 401 });

  const oauth2 = createOAuth2Client();
  oauth2.setCredentials(tokenDocToCredentials(tokenDoc));

  oauth2.on('tokens', async (newTokens) => {
    const update = {
      accessToken: newTokens.access_token || tokenDoc.accessToken,
      expiryDate: newTokens.expiry_date ? new Date(newTokens.expiry_date) : tokenDoc.expiryDate,
      tokens: { ...tokenDocToCredentials(tokenDoc), ...newTokens }
    };
    if (newTokens.refresh_token) update.refreshToken = newTokens.refresh_token;
    await GmailToken.updateOne({ userId }, { $set: update });
  });

  return oauth2;
}

export async function getGmailStatus(userId) {
  if (!isGmailConfigured()) return { connected: false, configured: false };
  const token = await GmailToken.findOne({ userId }).lean();
  if (!token) {
    return { connected: false, configured: true, userEmail: gmailConfig().user };
  }

  const userEmail = token.userEmail || gmailConfig().user;
  const hasAccess = Boolean(token.accessToken || token.tokens?.access_token);
  const hasRefresh = Boolean(token.refreshToken || token.tokens?.refresh_token);
  const expiry = token.expiryDate ? new Date(token.expiryDate).getTime() : 0;
  const accessValid = expiry > Date.now() + 60_000;

  if (!hasAccess) {
    return { connected: false, configured: true, userEmail };
  }
  if (accessValid) {
    return { connected: true, configured: true, userEmail };
  }
  if (!hasRefresh) {
    await clearGmailConnection(userId);
    return { connected: false, configured: true, userEmail };
  }

  try {
    const oauth2 = await getAuthenticatedClient(userId);
    await oauth2.getAccessToken();
    return { connected: true, configured: true, userEmail };
  } catch {
    await clearGmailConnection(userId);
    return { connected: false, configured: true, userEmail };
  }
}

export async function clearGmailConnection(userId) {
  await GmailToken.deleteOne({ userId });
}

async function withGmailAuthRecovery(userId, fn) {
  try {
    return await fn();
  } catch (error) {
    if (error.code === 'gmail_auth_expired' || error.invalidGrant || error.status === 401) {
      await clearGmailConnection(userId);
    }
    throw error;
  }
}

function getHeader(headers = [], name) {
  return headers.find((h) => h.name?.toLowerCase() === name.toLowerCase())?.value || '';
}

function decodeMimeHeader(value = '') {
  return value.replace(/=\?([^?]+)\?([BQ])\?([^?]+)\?=/gi, (_match, charset, encoding, text) => {
    try {
      const buffer =
        encoding.toUpperCase() === 'B'
          ? Buffer.from(text, 'base64')
          : Buffer.from(text.replace(/_/g, ' ').replace(/=([0-9A-F]{2})/gi, (_, hex) => String.fromCharCode(parseInt(hex, 16))), 'binary');
      return buffer.toString(charset.toLowerCase().includes('iso-8859-1') ? 'latin1' : 'utf8');
    } catch {
      return value;
    }
  });
}

function mapMessageSummary(message, fallback = {}) {
  const headers = message.payload?.headers || [];
  return {
    id: message.id || fallback.id,
    threadId: message.threadId || fallback.threadId,
    from: decodeMimeHeader(getHeader(headers, 'From')),
    to: decodeMimeHeader(getHeader(headers, 'To')),
    subject: decodeMimeHeader(getHeader(headers, 'Subject')),
    date: getHeader(headers, 'Date'),
    snippet: message.snippet || '',
    unread: (message.labelIds || []).includes('UNREAD')
  };
}

function extractBody(payload) {
  if (!payload) return '';
  if (payload.body?.data) {
    const normalized = payload.body.data.replace(/-/g, '+').replace(/_/g, '/');
    return Buffer.from(normalized, 'base64').toString('utf-8');
  }
  if (payload.parts) {
    for (const part of payload.parts) {
      if (part.mimeType === 'text/html' || part.mimeType === 'text/plain') {
        if (part.body?.data) {
          const normalized = part.body.data.replace(/-/g, '+').replace(/_/g, '/');
          return Buffer.from(normalized, 'base64').toString('utf-8');
        }
      }
      const nested = extractBody(part);
      if (nested) return nested;
    }
  }
  return '';
}

export async function listMessages(userId, { maxResults = 30, labelIds = 'INBOX' } = {}) {
  return withGmailAuthRecovery(userId, async () => {
    const oauth2 = await getAuthenticatedClient(userId);
    const labels = Array.isArray(labelIds) ? labelIds : String(labelIds || 'INBOX').split(',').filter(Boolean);
    const limit = Math.min(Math.max(Number(maxResults) || 30, 1), 30);

    const list = await gmailApiRequest(oauth2, 'get', '/users/me/messages', {
      params: {
        maxResults: limit,
        labelIds: labels
      }
    });

    const ids = list.messages || [];
    if (ids.length === 0) return [];

    const messages = [];
    const batchSize = 5;
    for (let index = 0; index < ids.length; index += batchSize) {
      const batch = ids.slice(index, index + batchSize);
      const details = await Promise.all(
        batch.map(async (msg) => {
          try {
            const detail = await gmailApiRequest(oauth2, 'get', `/users/me/messages/${msg.id}`, {
              params: {
                format: 'metadata',
                metadataHeaders: ['From', 'To', 'Subject', 'Date']
              }
            });
            return mapMessageSummary(detail, msg);
          } catch {
            const detail = await gmailApiRequest(oauth2, 'get', `/users/me/messages/${msg.id}`, {
              params: { format: 'full' }
            });
            return mapMessageSummary(detail, msg);
          }
        })
      );
      messages.push(...details);
    }
    return messages;
  });
}

export async function getMessage(userId, id, format = 'full') {
  const oauth2 = await getAuthenticatedClient(userId);
  const detail = await gmailApiRequest(oauth2, 'get', `/users/me/messages/${id}`, {
    params: {
      format: format === 'metadata' ? 'metadata' : 'full'
    }
  });
  return {
    ...mapMessageSummary(detail),
    body: format === 'full' ? extractBody(detail.payload) : ''
  };
}

function encodeRawEmail(lines) {
  const email = lines.join('\r\n');
  return Buffer.from(email)
    .toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
}

function encodeHeaderUtf8(value) {
  const s = String(value || '');
  if (!/[^\x00-\x7F]/.test(s)) return s;
  return `=?UTF-8?B?${Buffer.from(s, 'utf8').toString('base64')}?=`;
}

function wrapBase64(b64) {
  return String(b64 || '').replace(/.{1,76}/g, '$&\r\n').trim();
}

export async function sendMessage(userId, { to, subject, body, attachments = [] }) {
  const cfg = gmailConfig();
  const oauth2 = await getAuthenticatedClient(userId);
  const from = cfg.user;
  const encodedSubject = encodeHeaderUtf8(subject);

  let lines;
  if (attachments.length) {
    const boundary = `mecal_${Date.now()}_${Math.random().toString(16).slice(2)}`;
    lines = [
      `From: M-ECAL <${from}>`,
      `To: ${to}`,
      `Subject: ${encodedSubject}`,
      'MIME-Version: 1.0',
      `Content-Type: multipart/mixed; boundary="${boundary}"`,
      '',
      `--${boundary}`,
      'Content-Type: text/html; charset=utf-8',
      'Content-Transfer-Encoding: base64',
      '',
      wrapBase64(Buffer.from(body || '', 'utf8').toString('base64'))
    ];
    for (const att of attachments) {
      const filename = String(att.filename || 'piece-jointe').replace(/"/g, '');
      const mime = att.mimeType || 'application/octet-stream';
      lines.push(
        `--${boundary}`,
        `Content-Type: ${mime}; name="${filename}"`,
        'Content-Transfer-Encoding: base64',
        `Content-Disposition: attachment; filename="${filename}"`,
        '',
        wrapBase64(att.contentBase64)
      );
    }
    lines.push(`--${boundary}--`);
  } else {
    lines = [
      `From: M-ECAL <${from}>`,
      `To: ${to}`,
      `Subject: ${encodedSubject}`,
      'MIME-Version: 1.0',
      'Content-Type: text/html; charset=utf-8',
      '',
      body
    ];
  }

  const raw = encodeRawEmail(lines);
  return gmailApiRequest(oauth2, 'post', '/users/me/messages/send', { data: { raw } });
}

export async function replyToMessage(userId, id, { to, subject, body }) {
  const original = await getMessage(userId, id, 'full');
  const oauth2 = await getAuthenticatedClient(userId);
  const raw = encodeRawEmail([
    `To: ${to || original.from}`,
    `Subject: Re: ${subject || original.subject}`,
    `In-Reply-To: ${id}`,
    'MIME-Version: 1.0',
    'Content-Type: text/html; charset=utf-8',
    '',
    body
  ]);
  return gmailApiRequest(oauth2, 'post', '/users/me/messages/send', {
    data: { raw, threadId: original.threadId }
  });
}

export async function markAsRead(userId, id) {
  const oauth2 = await getAuthenticatedClient(userId);
  await gmailApiRequest(oauth2, 'post', `/users/me/messages/${id}/modify`, {
    data: { removeLabelIds: ['UNREAD'] }
  });
  return { success: true };
}

export async function archiveMessage(userId, id) {
  const oauth2 = await getAuthenticatedClient(userId);
  await gmailApiRequest(oauth2, 'post', `/users/me/messages/${id}/modify`, {
    data: { removeLabelIds: ['INBOX'] }
  });
  return { success: true };
}

export async function deleteMessage(userId, id) {
  const oauth2 = await getAuthenticatedClient(userId);
  await gmailApiRequest(oauth2, 'post', `/users/me/messages/${id}/trash`);
  return { success: true };
}

export async function saveDraft(userId, { to, subject, body }) {
  const cfg = gmailConfig();
  const oauth2 = await getAuthenticatedClient(userId);
  const raw = encodeRawEmail([
    `From: ${cfg.user}`,
    `To: ${to}`,
    `Subject: ${subject}`,
    'Content-Type: text/plain; charset=utf-8',
    '',
    body
  ]);
  return gmailApiRequest(oauth2, 'post', '/users/me/drafts', { data: { message: { raw } } });
}
