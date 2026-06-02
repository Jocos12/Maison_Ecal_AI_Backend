import mongoose from 'mongoose';
import GmailToken from '../models/GmailToken.js';
import {
  GMAIL_SCOPES,
  getGmailConfigDiagnostics,
  gmailConfig,
  isGmailConfigured
} from '../config/gmail.js';
import { createOAuth2Client, gmailApiRequest } from './gmailOAuth.js';

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
  return {
    connected: Boolean(token?.accessToken || token?.tokens?.access_token),
    configured: true,
    userEmail: token?.userEmail || gmailConfig().user
  };
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
  const oauth2 = await getAuthenticatedClient(userId);
  const labels = Array.isArray(labelIds) ? labelIds : String(labelIds).split(',');
  const list = await gmailApiRequest(oauth2, 'get', '/users/me/messages', {
    params: { maxResults: Math.min(Number(maxResults) || 30, 30), q: labels.map((label) => `in:${label.toLowerCase()}`).join(' ') }
  });

  const messages = [];
  const batchSize = 5;
  const ids = list.messages || [];
  for (let index = 0; index < ids.length; index += batchSize) {
    const batch = ids.slice(index, index + batchSize);
    const details = await Promise.all(
      batch.map(async (msg) => {
        const detail = await gmailApiRequest(oauth2, 'get', `/users/me/messages/${msg.id}`, {
          params: { format: 'metadata' }
        });
        return mapMessageSummary(detail, msg);
      })
    );
    messages.push(...details);
  }
  return messages;
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

export async function sendMessage(userId, { to, subject, body }) {
  const cfg = gmailConfig();
  const oauth2 = await getAuthenticatedClient(userId);
  const raw = encodeRawEmail([
    `From: M-ECAL <${cfg.user}>`,
    `To: ${to}`,
    `Subject: ${subject}`,
    'MIME-Version: 1.0',
    'Content-Type: text/html; charset=utf-8',
    '',
    body
  ]);
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
