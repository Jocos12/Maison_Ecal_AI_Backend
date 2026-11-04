import Application from '../models/Application.js';
import Contract from '../models/Contract.js';
import { isAdmin } from './contractService.js';
import { knownTimeline, rememberStatus } from './statusHistory.js';
import { recordAudit } from './auditService.js';

const APPLICATION_NEXT = {
  draft: 'submitted',
  submitted: 'pending',
  pending: 'interview',
  interview: 'won'
};

const CONTRACT_NEXT = {
  en_attente: 'en_cours',
  en_cours: 'gagne',
  gagne: 'termine'
};

function appTitle(row) {
  return row.opportunity?.title || row.externalOffer?.title || '';
}

function appOrg(row) {
  return row.opportunity?.organization || row.externalOffer?.organization || '';
}

function present(kind, doc) {
  const row = typeof doc.toObject === 'function' ? doc.toObject() : doc;
  const application = kind === 'application';
  return {
    id: String(row._id),
    kind,
    title: application ? appTitle(row) : row.title || '',
    organization: application ? appOrg(row) : row.client || '',
    status: row.status,
    updatedAt: row.updatedAt || row.createdAt || null,
    archivedAt: row.archivedAt || null,
    next: (application ? APPLICATION_NEXT : CONTRACT_NEXT)[row.status] || null,
    events: knownTimeline(row)
  };
}

function canTouchContract(user, doc) {
  if (!doc) return false;
  if (isAdmin(user)) return true;
  return String(doc.ownerId) === String(user?._id);
}

export async function listLifecycle({ archived = false } = {}) {
  const [applications, contracts] = await Promise.all([
    Application.find().populate('opportunity').sort({ updatedAt: -1 }).lean(),
    Contract.find().sort({ updatedAt: -1 }).lean()
  ]);
  return [...applications.map((row) => present('application', row)), ...contracts.map((row) => present('contract', row))]
    .filter((row) => archived || !row.archivedAt)
    .sort((a, b) => new Date(b.updatedAt || 0) - new Date(a.updatedAt || 0));
}

async function load(kind, id) {
  if (kind === 'application') return Application.findById(id);
  if (kind === 'contract') return Contract.findById(id);
  return null;
}

function entityLabel(kind, doc) {
  return kind === 'application' ? appTitle(doc) : doc.title || '';
}

export async function advanceLifecycle(kind, id, user, actor = null) {
  const doc = await load(kind, id);
  if (!doc) return { error: 404, message: 'Introuvable.' };
  if (kind === 'contract' && !canTouchContract(user, doc)) {
    return { error: 403, message: 'Vous ne pouvez pas modifier ce contrat.' };
  }
  const next = (kind === 'application' ? APPLICATION_NEXT : CONTRACT_NEXT)[doc.status];
  if (!next) return { error: 400, message: 'Aucune étape suivante enregistrée pour ce statut.' };
  const previous = doc.status;
  if (kind === 'application') await doc.populate('opportunity');
  doc.status = next;
  rememberStatus(doc, next);
  await doc.save();
  await recordAudit({
    action: 'status_change',
    entityType: kind === 'contract' ? 'contract' : 'application',
    entityId: doc._id,
    entityLabel: entityLabel(kind, doc),
    actorType: actor?.actorType || 'human',
    channel: actor?.channel || 'ui',
    actorUserId: actor?.actorUserId || user?._id,
    actorName: actor?.actorName || user?.name || '',
    changes: [{ field: 'status', from: previous, to: next }]
  });
  return { row: present(kind, doc) };
}

export async function archiveLifecycle(kind, id, user, actor = null) {
  const doc = await load(kind, id);
  if (!doc) return { error: 404, message: 'Introuvable.' };
  if (kind === 'contract' && !canTouchContract(user, doc)) {
    return { error: 403, message: 'Vous ne pouvez pas modifier ce contrat.' };
  }
  if (kind === 'application') await doc.populate('opportunity');
  const already = Boolean(doc.archivedAt);
  if (!doc.archivedAt) doc.archivedAt = new Date();
  await doc.save();
  if (!already) {
    await recordAudit({
      action: 'archive',
      entityType: kind === 'contract' ? 'contract' : 'application',
      entityId: doc._id,
      entityLabel: entityLabel(kind, doc),
      actorType: actor?.actorType || 'human',
      channel: actor?.channel || 'ui',
      actorUserId: actor?.actorUserId || user?._id,
      actorName: actor?.actorName || user?.name || '',
      changes: [{ field: 'archived', from: null, to: 'archived' }]
    });
  }
  return { row: present(kind, doc) };
}
