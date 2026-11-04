import AuditLog from '../models/AuditLog.js';
import logger from '../utils/logger.js';

function clip(value) {
  if (value == null || value === '') return null;
  if (value instanceof Date) return value.toISOString().slice(0, 10);
  if (typeof value === 'string') return value.length > 160 ? `${value.slice(0, 157)}…` : value;
  if (typeof value === 'number' || typeof value === 'boolean') return value;
  return String(value).slice(0, 160);
}

export function changedFields(before = {}, after = {}, fields = []) {
  const changes = [];
  for (const field of fields) {
    const from = clip(before[field]);
    const to = clip(after[field]);
    if (from === to) continue;
    changes.push({ field, from, to });
  }
  return changes;
}

/** Who did it. The account is always the signed-in user. Agent only when the request says so, with voice or text. */
export function actorFromRequest(req) {
  const origin = req?.body?.auditOrigin || {};
  const asked = origin.actor === 'agent' || req?.get?.('x-mecal-actor') === 'agent';
  const channel = origin.channel || req?.get?.('x-mecal-channel') || '';
  const isAgent = asked && (channel === 'voice' || channel === 'text');
  return {
    actorType: isAgent ? 'agent' : 'human',
    channel: isAgent ? channel : 'ui',
    actorUserId: req?.userId || req?.user?._id || null,
    actorName: req?.user?.name || req?.userEmail || ''
  };
}

export function authorLabel(entry) {
  const name = entry.actorName || '';
  if (entry.actorType === 'agent') return name ? `Agent IA (pour ${name})` : 'Agent IA';
  return name || 'Utilisateur';
}

export async function recordAudit(entry) {
  try {
    const doc = await AuditLog.create({
      action: entry.action,
      entityType: entry.entityType,
      entityId: entry.entityId ? String(entry.entityId) : '',
      entityLabel: String(entry.entityLabel || '').slice(0, 240),
      actorType: entry.actorType === 'agent' ? 'agent' : 'human',
      channel: ['voice', 'text'].includes(entry.channel) && entry.actorType === 'agent' ? entry.channel : entry.actorType === 'agent' ? 'text' : 'ui',
      actorUserId: entry.actorUserId || null,
      actorName: String(entry.actorName || '').slice(0, 120),
      changes: Array.isArray(entry.changes) ? entry.changes.slice(0, 12) : []
    });
    return doc;
  } catch (error) {
    logger.error('Audit log write failed', {
      message: error?.message || String(error),
      action: entry?.action,
      entityType: entry?.entityType
    });
    return null;
  }
}

export async function listAudit({ action, actor, entity, from, to, q } = {}) {
  const filter = {};
  if (action) filter.action = action;
  if (actor === 'human' || actor === 'agent') filter.actorType = actor;
  if (entity) filter.entityType = entity;
  if (from || to) {
    filter.createdAt = {};
    if (from) filter.createdAt.$gte = new Date(from);
    if (to) {
      const end = new Date(to);
      end.setHours(23, 59, 59, 999);
      filter.createdAt.$lte = end;
    }
  }
  if (q) {
    const safe = String(q).trim().slice(0, 80).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    if (safe) {
      const re = new RegExp(safe, 'i');
      filter.$or = [{ entityLabel: re }, { actorName: re }];
    }
  }
  const rows = await AuditLog.find(filter).sort({ createdAt: -1 }).limit(300).lean();
  return rows.map((row) => ({
    id: String(row._id),
    at: row.createdAt,
    action: row.action,
    entityType: row.entityType,
    entityId: row.entityId,
    entityLabel: row.entityLabel,
    actorType: row.actorType,
    channel: row.channel,
    actorName: row.actorName,
    authorLabel: authorLabel(row),
    changes: row.changes || []
  }));
}
