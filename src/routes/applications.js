import { Router } from 'express';
import { stripUnsafeKeys } from '../utils/requestSafety.js';
import { contentDisposition, contentTypeFor, validateUpload } from '../utils/uploadPolicy.js';
import fs from 'fs/promises';
import path from 'path';
import crypto from 'crypto';
import mongoose from 'mongoose';
import { fileURLToPath } from 'url';
import Application from '../models/Application.js';
import NrcNotice from '../models/NrcNotice.js';
import User from '../models/User.js';
import { sendApplicationEmail, previewApplicationEmail } from '../services/applicationEmailService.js';
import { rememberStatus } from '../services/statusHistory.js';
import { actorFromRequest, changedFields, recordAudit } from '../services/auditService.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const UPLOAD_DIR = path.join(__dirname, '../../uploads/application-docs');

const router = Router();

/** Champs techniques que le client ne doit jamais fixer lui-même. */
const PROTECTED_FIELDS = ['_id', '__v', 'createdAt', 'updatedAt', 'statusEvents', 'archivedAt', 'auditOrigin'];
const sanitizeApplicationBody = (input) => stripUnsafeKeys(input, PROTECTED_FIELDS);


const ORG_NAME = { nrc: 'NRC', irc: 'IRC', drcngo: 'DRC', icrc: 'ICRC' };

function presentApplication(app) {
  if (!app) return app;
  const row = typeof app.toObject === 'function' ? app.toObject() : { ...app };
  if (row.opportunity || !row.externalOffer?.title) return row;
  const o = row.externalOffer;
  const org = String(o.organization || 'nrc').toLowerCase();
  row.opportunity = {
    title: o.title,
    organization: ORG_NAME[org] || org.toUpperCase(),
    sourceUrl: o.url,
    ville: o.ville || '',
    country: o.country || '',
    deadline: o.deadline || null,
    description: o.description || '',
    reference: o.reference || '',
    platform: ORG_NAME[org] || org.toUpperCase(),
    externalNotice: true
  };
  return row;
}

function snapshotNotice(notice) {
  const org = String(notice.organization || 'nrc').toLowerCase();
  return {
    title: notice.title,
    organization: org,
    url: notice.applyUrl || notice.url || '',
    ville: notice.location || notice.country || '',
    country: notice.country || '',
    deadline: notice.deadline || undefined,
    description: String(notice.description || '').slice(0, 4000),
    reference: notice.reference || ''
  };
}

async function ensureUploadDir() {
  await fs.mkdir(UPLOAD_DIR, { recursive: true });
}

const APPLICATION_FIELDS = ['status', 'notes', 'rejectionReason', 'sendMethod', 'handledBy'];

function applicationLabel(doc) {
  return doc?.opportunity?.title || doc?.externalOffer?.title || 'Candidature';
}

function auditApplication(actor, action, doc, changes = []) {
  const finalAction = action === 'update' && changes.some((change) => change.field === 'status') ? 'status_change' : action;
  return recordAudit({
    action: finalAction,
    entityType: 'application',
    entityId: doc?._id,
    entityLabel: applicationLabel(doc),
    ...actor,
    changes
  });
}

function safeBaseName(name = 'document.pdf') {
  return name.replace(/[^\w\s.-]/g, '').replace(/\s+/g, '-').slice(0, 80) || 'document.pdf';
}

router.get('/', async (req, res, next) => {
  try {
    const list = await Application.find()
      .populate('opportunity')
      .sort({ updatedAt: -1 })
      .lean();
    res.json(list.map(presentApplication));
  } catch (e) {
    next(e);
  }
});

router.post('/', async (req, res, next) => {
  try {
    const actor = actorFromRequest(req);
    const body = sanitizeApplicationBody(req.body);
    delete body.auditOrigin;
    if (body.notice && !body.opportunity) {
      if (!mongoose.Types.ObjectId.isValid(body.notice)) {
        return res.status(400).json({ message: 'Avis introuvable.' });
      }
      const notice = await NrcNotice.findById(body.notice).select('title organization url applyUrl location country deadline description reference isLogistics').lean();
      if (!notice) return res.status(404).json({ message: 'Avis introuvable.' });
      const existing = await Application.findOne({ notice: notice._id }).lean();
      if (existing) return res.status(200).json({ ...presentApplication(existing), alreadyExisted: true });
      const doc = await Application.create({
        notice: notice._id,
        status: 'draft',
        externalOffer: snapshotNotice(notice)
      });
      rememberStatus(doc, doc.status || 'draft');
      await doc.save();
      await auditApplication(actor, 'create', doc);
      return res.status(201).json(presentApplication(doc));
    }
    if (!body.opportunity) {
      return res.status(400).json({ message: 'Offre requise.' });
    }
    if (Array.isArray(body.documents)) {
      body.documents = body.documents.filter((d) => d?.url && !/^file:\/\//i.test(d.url));
    }
    const existing = await Application.findOne({ opportunity: body.opportunity })
      .populate('opportunity')
      .lean();
    if (existing) {
      return res.status(200).json({ ...existing, alreadyExisted: true });
    }
    body.status = body.status || 'draft';
    delete body.statusEvents;
    delete body.archivedAt;
    const doc = await Application.create(body);
    rememberStatus(doc, doc.status);
    await doc.save();
    const populated = await doc.populate('opportunity');
    await auditApplication(actor, doc.status === 'submitted' ? 'application_sent' : 'create', populated);
    res.status(201).json(populated);
  } catch (e) {
    next(e);
  }
});

router.post('/preview-email', async (req, res, next) => {
  try {
    const { opportunityId, applicationId, letterOverride } = req.body || {};
    if (!opportunityId && !applicationId) {
      return res.status(400).json({ message: 'opportunityId ou applicationId requis.' });
    }
    const preview = await previewApplicationEmail({
      userId: req.userId,
      opportunityId,
      applicationId,
      letterOverride
    });
    res.json(preview);
  } catch (e) {
    next(e);
  }
});

router.post('/send-email', async (req, res, next) => {
  try {
    const { opportunityId, applicationId, confirmed, to, subject, body } = req.body || {};
    const result = await sendApplicationEmail({
      userId: req.userId,
      opportunityId,
      applicationId,
      confirmed,
      to,
      subject,
      body,
      actor: actorFromRequest(req)
    });
    res.json({ success: true, ...result });
  } catch (e) {
    next(e);
  }
});

router.patch('/:id', async (req, res, next) => {
  try {
    const actor = actorFromRequest(req);
    const body = sanitizeApplicationBody(req.body);
    delete body.auditOrigin;
    if (body.sendMethod === '' || body.sendMethod == null) {
      delete body.sendMethod;
    }
    if (body.sentOn === '') body.sentOn = null;
    if (body.followUpDate === '') body.followUpDate = null;
    if (Array.isArray(body.followUps)) {
      body.followUps = body.followUps
        .filter((f) => f && (f.date || f.note))
        .map((f) => ({
          date: f.date || null,
          note: String(f.note || '').slice(0, 2000),
          createdAt: f.createdAt || new Date()
        }));
    }
    if (Array.isArray(body.documents)) {
      body.documents = body.documents
        .map((d) => ({
          name: d.name,
          url: d.url && !/^file:\/\//i.test(d.url) ? d.url : '',
          documentId: d.documentId || undefined,
          storageKey: d.storageKey || undefined
        }))
        .filter((d) => d.url || d.documentId || d.storageKey);
    }
    delete body.statusEvents;
    delete body.archivedAt;
    const before = await Application.findById(req.params.id).populate('opportunity');
    if (body.status) {
      const current = await Application.findById(req.params.id);
      if (!current) return res.status(404).json({ message: 'Not found' });
      if (body.status !== current.status) {
        rememberStatus(current, body.status);
        body.statusEvents = current.statusEvents;
      }
    }
    const doc = await Application.findByIdAndUpdate(req.params.id, body, {
      new: true,
      runValidators: true
    }).populate('opportunity');
    if (!doc) return res.status(404).json({ message: 'Not found' });
    const changes = before ? changedFields(before.toObject(), doc.toObject(), APPLICATION_FIELDS) : [];
    if (changes.length) await auditApplication(actor, 'update', doc, changes);
    res.json(presentApplication(doc));
  } catch (e) {
    next(e);
  }
});

router.post('/:id/documents/upload', async (req, res, next) => {
  try {
    const { fileName, fileBase64, mimeType } = req.body || {};
    if (!fileName || !fileBase64) {
      return res.status(400).json({ message: 'fileName et fileBase64 requis.' });
    }

    const buffer = Buffer.from(String(fileBase64), 'base64');
    const invalid = validateUpload({ fileName, buffer });
    if (invalid) return res.status(400).json({ message: invalid });

    const app = await Application.findById(req.params.id);
    if (!app) return res.status(404).json({ message: 'Candidature introuvable.' });

    await ensureUploadDir();
    const storageKey = `${crypto.randomBytes(10).toString('hex')}-${safeBaseName(fileName)}`;
    const filePath = path.join(UPLOAD_DIR, storageKey);
    await fs.writeFile(filePath, buffer);

    const url = `/api/applications/documents/file/${storageKey}`;
    app.documents.push({
      name: fileName,
      url,
      storageKey
    });
    await app.save();
    const populated = await app.populate('opportunity');
    res.json({ document: app.documents[app.documents.length - 1], application: presentApplication(populated) });
  } catch (e) {
    next(e);
  }
});

router.post('/:id/attach-cv', async (req, res, next) => {
  try {
    const app = await Application.findById(req.params.id);
    if (!app) return res.status(404).json({ message: 'Candidature introuvable.' });
    const user = await User.findById(req.userId).select('jobAssistantProfile').lean();
    const filePath = user?.jobAssistantProfile?.cvFilePath;
    const fileName = user?.jobAssistantProfile?.cvFileName;
    if (!filePath || !fileName) {
      return res.status(400).json({ message: 'Aucun CV importé. Importez-le d’abord dans l’agent.' });
    }
    const already = (app.documents || []).some(
      (d) => d.name === fileName || d.storageKey?.includes(fileName.replace(/\s+/g, '-'))
    );
    if (already) {
      const populated = await app.populate('opportunity');
      return res.json({ alreadyAttached: true, application: presentApplication(populated) });
    }
    const buf = await fs.readFile(filePath);
    await ensureUploadDir();
    const storageKey = `${crypto.randomBytes(10).toString('hex')}-${safeBaseName(fileName)}`;
    await fs.writeFile(path.join(UPLOAD_DIR, storageKey), buf);
    app.documents.push({
      name: fileName,
      url: `/api/applications/documents/file/${storageKey}`,
      storageKey
    });
    await app.save();
    const populated = await app.populate('opportunity');
    res.json({ alreadyAttached: false, application: presentApplication(populated) });
  } catch (e) {
    next(e);
  }
});

router.get('/documents/file/:key', async (req, res, next) => {
  try {
    const key = path.basename(req.params.key);
    if (!key || key.includes('..')) {
      return res.status(400).json({ message: 'Clé invalide.' });
    }
    const filePath = path.join(UPLOAD_DIR, key);
    const exists = await fs.access(filePath).then(() => true).catch(() => false);
    if (!exists) return res.status(404).json({ message: 'Fichier introuvable.' });

    const buffer = await fs.readFile(filePath);
    res.setHeader('Content-Type', contentTypeFor(key));
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Content-Disposition', contentDisposition(key));
    res.send(buffer);
  } catch (e) {
    next(e);
  }
});

router.delete('/:id', async (req, res, next) => {
  try {
    const doc = await Application.findById(req.params.id).populate('opportunity');
    if (doc) {
      await doc.deleteOne();
      await auditApplication(actorFromRequest(req), 'delete', doc);
    }
    res.status(204).send();
  } catch (e) {
    next(e);
  }
});

export default router;
