import { Router } from 'express';
import Contract, { CONTRACT_STATUSES, CONTRACT_TYPES } from '../models/Contract.js';
import {
  answerFromContracts,
  contractStats,
  isAdmin,
  listContracts
} from '../services/contractService.js';
import { rememberStatus } from '../services/statusHistory.js';
import { actorFromRequest, changedFields, recordAudit } from '../services/auditService.js';

const router = Router();

function clean(body = {}) {
  const title = String(body.title || '').trim();
  const client = String(body.client || '').trim();
  const type = String(body.type || '').trim();
  const status = String(body.status || 'en_attente').trim();
  const errors = [];
  if (!title) errors.push('Le titre est obligatoire.');
  if (!client) errors.push('Le client est obligatoire.');
  if (!CONTRACT_TYPES.includes(type)) errors.push('Type invalide.');
  if (!CONTRACT_STATUSES.includes(status)) errors.push('Statut invalide.');
  let amount = null;
  if (body.amount !== '' && body.amount != null) {
    const n = Number(body.amount);
    if (!Number.isFinite(n) || n < 0) errors.push('Le montant doit être un nombre positif.');
    else amount = n;
  }
  return {
    errors,
    value: {
      title,
      client,
      type,
      status,
      amount,
      startDate: body.startDate ? new Date(body.startDate) : null,
      endDate: body.endDate ? new Date(body.endDate) : null,
      notes: String(body.notes || '').trim()
    }
  };
}

const CONTRACT_FIELDS = ['title', 'client', 'type', 'status', 'amount', 'startDate', 'endDate', 'notes'];

function auditContract(actor, action, doc, changes = []) {
  const finalAction = action === 'update' && changes.some((change) => change.field === 'status') ? 'status_change' : action;
  return recordAudit({
    action: finalAction,
    entityType: 'contract',
    entityId: doc?._id,
    entityLabel: doc?.title || '',
    ...actor,
    changes
  });
}

function canEdit(user, doc) {
  if (!doc) return false;
  if (isAdmin(user)) return true;
  return String(doc.ownerId) === String(user?._id || user?.id);
}

router.get('/', async (req, res, next) => {
  try {
    const rows = await listContracts({
      userId: req.userId,
      owner: req.query.owner === 'me' ? 'me' : 'all',
      status: req.query.status,
      type: req.query.type,
      from: req.query.from,
      to: req.query.to
    });
    res.json(rows);
  } catch (e) {
    next(e);
  }
});

router.get('/stats', async (req, res, next) => {
  try {
    const stats = await contractStats({
      userId: req.userId,
      owner: req.query.owner === 'me' ? 'me' : 'all',
      status: req.query.status,
      type: req.query.type,
      from: req.query.from,
      to: req.query.to
    });
    res.json(stats);
  } catch (e) {
    next(e);
  }
});

router.post('/ask', async (req, res, next) => {
  try {
    const rows = await listContracts({
      userId: req.userId,
      owner: req.body?.owner === 'me' ? 'me' : 'all',
      status: req.body?.status,
      type: req.body?.type,
      from: req.body?.from,
      to: req.body?.to
    });
    res.json({
      reply: answerFromContracts(req.body?.question, rows, req.userId),
      source: 'contracts'
    });
  } catch (e) {
    next(e);
  }
});

router.post('/', async (req, res, next) => {
  try {
    const { errors, value } = clean(req.body);
    if (errors.length) return res.status(400).json({ message: errors[0], errors });
    const doc = new Contract({
      ...value,
      ownerId: req.userId,
      ownerName: req.user?.name || req.userEmail || ''
    });
    rememberStatus(doc, doc.status);
    await doc.save();
    await auditContract(actorFromRequest(req), 'create', doc);
    res.status(201).json(doc);
  } catch (e) {
    next(e);
  }
});

router.post('/:id/duplicate', async (req, res, next) => {
  try {
    const source = await Contract.findById(req.params.id);
    if (!source) return res.status(404).json({ message: 'Contrat introuvable.' });
    const doc = new Contract({
      title: `${source.title} (copie)`,
      client: source.client,
      type: source.type,
      status: source.status,
      amount: source.amount,
      startDate: source.startDate,
      endDate: source.endDate,
      notes: source.notes,
      ownerId: req.userId,
      ownerName: req.user?.name || req.userEmail || ''
    });
    rememberStatus(doc, doc.status);
    await doc.save();
    await auditContract(actorFromRequest(req), 'create', doc, [
      { field: 'title', from: source.title, to: doc.title }
    ]);
    res.status(201).json(doc);
  } catch (e) {
    next(e);
  }
});

router.put('/:id', async (req, res, next) => {
  try {
    const doc = await Contract.findById(req.params.id);
    if (!doc) return res.status(404).json({ message: 'Contrat introuvable.' });
    if (!canEdit(req.user, doc)) return res.status(403).json({ message: 'Vous ne pouvez pas modifier ce contrat.' });
    const { errors, value } = clean(req.body);
    if (errors.length) return res.status(400).json({ message: errors[0], errors });
    const previous = doc.toObject();
    Object.assign(doc, value);
    if (value.status !== previous.status) rememberStatus(doc, value.status);
    await doc.save();
    await auditContract(actorFromRequest(req), 'update', doc, changedFields(previous, doc.toObject(), CONTRACT_FIELDS));
    res.json(doc);
  } catch (e) {
    next(e);
  }
});

router.delete('/:id', async (req, res, next) => {
  try {
    const doc = await Contract.findById(req.params.id);
    if (!doc) return res.status(404).json({ message: 'Contrat introuvable.' });
    if (!canEdit(req.user, doc)) return res.status(403).json({ message: 'Vous ne pouvez pas supprimer ce contrat.' });
    await doc.deleteOne();
    await auditContract(actorFromRequest(req), 'delete', doc);
    res.json({ deleted: true });
  } catch (e) {
    next(e);
  }
});

export default router;
