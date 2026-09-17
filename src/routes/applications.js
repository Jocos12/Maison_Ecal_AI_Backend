import { Router } from 'express';
import fs from 'fs/promises';
import path from 'path';
import crypto from 'crypto';
import { fileURLToPath } from 'url';
import Application from '../models/Application.js';
import User from '../models/User.js';
import { sendApplicationEmail, previewApplicationEmail } from '../services/applicationEmailService.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const UPLOAD_DIR = path.join(__dirname, '../../uploads/application-docs');

const router = Router();

async function ensureUploadDir() {
  await fs.mkdir(UPLOAD_DIR, { recursive: true });
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
    res.json(list);
  } catch (e) {
    next(e);
  }
});

router.post('/', async (req, res, next) => {
  try {
    const body = { ...req.body };
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
    const doc = await Application.create(body);
    const populated = await doc.populate('opportunity');
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
      body
    });
    res.json({ success: true, ...result });
  } catch (e) {
    next(e);
  }
});

router.patch('/:id', async (req, res, next) => {
  try {
    const body = { ...req.body };
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
    const doc = await Application.findByIdAndUpdate(req.params.id, body, {
      new: true,
      runValidators: true
    }).populate('opportunity');
    if (!doc) return res.status(404).json({ message: 'Not found' });
    res.json(doc);
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

    const app = await Application.findById(req.params.id);
    if (!app) return res.status(404).json({ message: 'Candidature introuvable.' });

    await ensureUploadDir();
    const storageKey = `${crypto.randomBytes(10).toString('hex')}-${safeBaseName(fileName)}`;
    const filePath = path.join(UPLOAD_DIR, storageKey);
    await fs.writeFile(filePath, Buffer.from(fileBase64, 'base64'));

    const url = `/api/applications/documents/file/${storageKey}`;
    app.documents.push({
      name: fileName,
      url,
      storageKey
    });
    await app.save();
    const populated = await app.populate('opportunity');
    res.json({ document: app.documents[app.documents.length - 1], application: populated });
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
      return res.json({ alreadyAttached: true, application: populated });
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
    res.json({ alreadyAttached: false, application: populated });
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
    const lower = key.toLowerCase();
    const type = lower.endsWith('.pdf')
      ? 'application/pdf'
      : lower.endsWith('.docx')
        ? 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
        : 'application/octet-stream';

    res.setHeader('Content-Type', type);
    res.setHeader('Content-Disposition', `attachment; filename="${key}"`);
    res.send(buffer);
  } catch (e) {
    next(e);
  }
});

router.delete('/:id', async (req, res, next) => {
  try {
    await Application.findByIdAndDelete(req.params.id);
    res.status(204).send();
  } catch (e) {
    next(e);
  }
});

export default router;
