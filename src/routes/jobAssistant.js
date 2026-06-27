import { Router } from 'express';
import fs from 'fs/promises';
import path from 'path';
import JobAssistantDocument from '../models/JobAssistantDocument.js';
import {
  appendAndProcessMessage,
  createConversation,
  deleteConversation,
  generateJobDocument,
  getConversation,
  listConversations,
  persistDocumentInConversation,
  syncConversationMessages,
  updateSelectedOffer
} from '../services/jobConversationService.js';
import {
  getSubmissionHistory,
  submitJobApplication
} from '../services/jobAssistantService.js';

import {
  getJobAssistantProfile,
  saveCvFileForUser,
  saveJobAssistantProfile
} from '../services/jobAssistantProfileService.js';
import { parseCvTextToProfile, extractTextFromCvFile } from '../services/jobCvParseService.js';
import {
  chatAboutRdcOffer,
  rankOffersForMecal
} from '../services/rdcOfferAdviceService.js';

const router = Router();

router.post('/rdc-offers/rank', async (req, res, next) => {
  try {
    const { offers = [], forceAi = false } = req.body || {};
    const result = await rankOffersForMecal(offers, { forceAi: Boolean(forceAi) });
    res.json(result);
  } catch (e) {
    next(e);
  }
});

router.post('/rdc-offers/chat', async (req, res, next) => {
  try {
    const { offer, offers = [], messages = [], message, systemContext } = req.body || {};
    if (!message?.trim()) {
      return res.status(400).json({ message: 'Message requis.' });
    }
    const result = await chatAboutRdcOffer({
      offer,
      offers,
      messages,
      message: message.trim(),
      systemContext
    });
    res.json(result);
  } catch (e) {
    res.json({
      reply:
        'Le conseiller IA est temporairement indisponible. Vérifiez les clés IA dans le fichier .env du backend (GROQ, Gemini ou Claude).',
      jobs: [],
      isSearch: false,
      provider: null
    });
  }
});

router.get('/profile', async (req, res, next) => {
  try {
    const data = await getJobAssistantProfile(req.userId);
    res.json(data);
  } catch (e) {
    if (e.status === 404) return res.status(404).json({ message: e.message });
    next(e);
  }
});

router.put('/profile', async (req, res, next) => {
  try {
    const data = await saveJobAssistantProfile(req.userId, req.body?.profile || req.body || {});
    res.json(data);
  } catch (e) {
    if (e.status === 404) return res.status(404).json({ message: e.message });
    next(e);
  }
});

router.post('/profile/parse-cv', async (req, res, next) => {
  try {
    const { cvText, fileName, fileBase64, mimeType, replaceExisting = true } = req.body || {};
    let text = cvText?.trim() || '';

    if (!text && fileName && fileBase64) {
      const buffer = Buffer.from(fileBase64, 'base64');
      if (buffer.length > 5 * 1024 * 1024) {
        return res.status(400).json({ message: 'CV trop volumineux (max 5 Mo).' });
      }
      text = await extractTextFromCvFile(buffer, { originalName: fileName, mimeType });
      await saveCvFileForUser(req.userId, { buffer, originalName: fileName });
    } else if (fileName && fileBase64) {
      const buffer = Buffer.from(fileBase64, 'base64');
      if (buffer.length <= 5 * 1024 * 1024) {
        await saveCvFileForUser(req.userId, { buffer, originalName: fileName });
      }
    }

    if (!text) {
      return res.status(400).json({ message: 'Fichier CV requis (PDF, DOCX ou TXT).' });
    }

    const current = await getJobAssistantProfile(req.userId);
    const parsed = await parseCvTextToProfile(text, {
      existingProfile: replaceExisting ? {} : current.profile
    });

    const saved = await saveJobAssistantProfile(req.userId, parsed.profile);
    res.json({
      ...saved,
      filledCount: parsed.filledCount,
      method: parsed.method,
      message: `${parsed.filledCount} champ(s) rempli(s) depuis le CV.`
    });
  } catch (e) {
    next(e);
  }
});

router.post('/conversations', async (req, res, next) => {
  try {
    const conversation = await createConversation(req.userId);
    res.status(201).json({ conversation });
  } catch (e) {
    next(e);
  }
});

router.get('/conversations', async (req, res, next) => {
  try {
    const conversations = await listConversations(req.userId);
    res.json({ conversations });
  } catch (e) {
    next(e);
  }
});

router.get('/conversations/:id', async (req, res, next) => {
  try {
    const conversation = await getConversation(req.userId, req.params.id);
    res.json({ conversation });
  } catch (e) {
    if (e.status === 404) return res.status(404).json({ message: e.message });
    next(e);
  }
});

router.delete('/conversations/:id', async (req, res, next) => {
  try {
    const result = await deleteConversation(req.userId, req.params.id);
    res.json(result);
  } catch (e) {
    if (e.status === 404) return res.status(404).json({ message: e.message });
    next(e);
  }
});

router.patch('/conversations/:id', async (req, res, next) => {
  try {
    const { selectedOffer } = req.body || {};
    const conversation = await updateSelectedOffer(req.userId, req.params.id, selectedOffer);
    res.json({ conversation });
  } catch (e) {
    if (e.status === 404) return res.status(404).json({ message: e.message });
    next(e);
  }
});

router.put('/conversations/:id/sync', async (req, res, next) => {
  try {
    const { messages = [], title } = req.body || {};
    const conversation = await syncConversationMessages(req.userId, req.params.id, {
      messages,
      title
    });
    res.json({ conversation });
  } catch (e) {
    if (e.status === 404) return res.status(404).json({ message: e.message });
    next(e);
  }
});

router.post('/conversations/:id/messages', async (req, res, next) => {
  try {
    const { message, locale, systemPrompt } = req.body || {};
    if (!message?.trim()) {
      return res.status(400).json({ message: 'Message requis.' });
    }
    const result = await appendAndProcessMessage(req.userId, req.params.id, message.trim(), {
      sources: req.body?.sources,
      locale: locale || null,
      systemPrompt: systemPrompt || null
    });
    res.json(result);
  } catch (e) {
    if (e.status === 404) return res.status(404).json({ message: e.message });
    next(e);
  }
});

router.post('/search', async (req, res, next) => {
  try {
    const { query, city, role, conversationId, message, sources } = req.body || {};
    if (conversationId && message) {
      const result = await appendAndProcessMessage(req.userId, conversationId, message);
      return res.json(result);
    }
    const { searchJobsWithAI } = await import('../services/jobSearchService.js');
    const result = await searchJobsWithAI({ query, city, role, sources });
    res.json(result);
  } catch (e) {
    next(e);
  }
});

router.post('/chat', async (req, res, next) => {
  try {
    const { conversationId, message } = req.body || {};
    if (conversationId && message) {
      const result = await appendAndProcessMessage(req.userId, conversationId, message);
      return res.json(result);
    }
    const { messages = [], message: legacyMessage } = req.body || {};
    if (!legacyMessage?.trim()) {
      return res.status(400).json({ message: 'Message requis.' });
    }
    const { chatWithJobAssistant } = await import('../services/jobAssistantService.js');
    const result = await chatWithJobAssistant({
      messages: [...messages, { role: 'user', content: legacyMessage }]
    });
    res.json(result);
  } catch (e) {
    next(e);
  }
});

router.post('/generate-document', async (req, res, next) => {
  try {
    const { type, job, profile, conversationId, mode, locale } = req.body || {};
    const result = await generateJobDocument({
      userId: req.userId,
      type,
      job,
      profile,
      mode,
      locale: locale || 'fr'
    });
    if (conversationId) {
      const conversation = await persistDocumentInConversation(
        req.userId,
        conversationId,
        result,
        job
      );
      return res.json({ ...result, conversation });
    }
    res.json(result);
  } catch (e) {
    next(e);
  }
});

router.post('/submit-application', async (req, res, next) => {
  try {
    const { confirmed, documentId, job, to, subject, body } = req.body || {};
    const result = await submitJobApplication({
      userId: req.userId,
      confirmed,
      documentId,
      job,
      to,
      subject,
      body
    });
    res.json(result);
  } catch (e) {
    next(e);
  }
});

router.get('/submissions', async (req, res, next) => {
  try {
    const rows = await getSubmissionHistory(req.userId);
    res.json({ submissions: rows });
  } catch (e) {
    next(e);
  }
});

router.get('/documents/:id/download', async (req, res, next) => {
  try {
    const doc = await JobAssistantDocument.findOne({
      _id: req.params.id,
      userId: req.userId
    });
    if (!doc) {
      return res.status(404).json({ message: 'Document introuvable.' });
    }
    const exists = await fs.access(doc.filePath).then(() => true).catch(() => false);
    if (!exists) {
      return res.status(404).json({ message: 'Fichier PDF introuvable.' });
    }
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="${path.basename(doc.fileName)}"`);
    const buffer = await fs.readFile(doc.filePath);
    res.send(buffer);
  } catch (e) {
    next(e);
  }
});

export default router;
