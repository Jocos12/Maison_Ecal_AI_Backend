import fs from 'fs/promises';
import Application from '../models/Application.js';
import Opportunity from '../models/Opportunity.js';
import User from '../models/User.js';
import { generateMotivationLetter } from './aiClassifierService.js';
import { getJobAssistantProfile } from './jobAssistantProfileService.js';
import { extractOpportunityContactEmail } from '../utils/extractContactEmail.js';
import { getGmailStatus, sendMessage } from './gmailService.js';
import SystemSetting from '../models/SystemSetting.js';
import { letterToHtml } from '../utils/letterToHtml.js';
import { stripMarkdown } from '../utils/stripMarkdown.js';

function mimeForName(name = '') {
  const lower = name.toLowerCase();
  if (lower.endsWith('.pdf')) return 'application/pdf';
  if (lower.endsWith('.docx')) {
    return 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
  }
  if (lower.endsWith('.doc')) return 'application/msword';
  return 'application/octet-stream';
}

async function getCombinedProfile(userId) {
  const company = (await SystemSetting.findOne({ key: 'mecal_profile' }).lean())?.value || {};
  let cv = {};
  let cvFileName = '';
  if (userId) {
    try {
      const job = await getJobAssistantProfile(userId);
      cv = job.profile || {};
      cvFileName = job.cv?.fileName || '';
    } catch {
      /* optional */
    }
  }
  return { ...company, ...cv, cvFileName };
}

async function loadCvAttachment(userId) {
  const user = await User.findById(userId).select('jobAssistantProfile').lean();
  const filePath = user?.jobAssistantProfile?.cvFilePath;
  const fileName = user?.jobAssistantProfile?.cvFileName;
  if (!filePath || !fileName) return null;
  try {
    const buf = await fs.readFile(filePath);
    return {
      filename: fileName,
      mimeType: mimeForName(fileName),
      contentBase64: buf.toString('base64'),
      exists: true
    };
  } catch {
    return { filename: fileName, exists: false };
  }
}

export async function previewApplicationEmail({ userId, opportunityId, applicationId, letterOverride }) {
  let opp = null;
  let app = null;
  if (applicationId) {
    app = await Application.findById(applicationId).populate('opportunity');
    opp = app?.opportunity;
  }
  if (!opp && opportunityId) {
    opp = await Opportunity.findById(opportunityId).lean();
  }
  if (!opp) {
    const err = new Error('Offre introuvable.');
    err.status = 404;
    throw err;
  }

  const profile = await getCombinedProfile(userId);
  const letter = stripMarkdown(
    String(letterOverride || app?.letterText || '').trim() || (await generateMotivationLetter(opp, profile))
  );
  const to = extractOpportunityContactEmail(opp) || app?.contactPerson?.email || '';
  const subject = `Candidature — ${opp.title}`;
  const cv = await loadCvAttachment(userId);
  const gmail = await getGmailStatus(userId).catch(() => ({ connected: false, userEmail: null }));

  return {
    opportunityId: String(opp._id),
    applicationId: app?._id ? String(app._id) : null,
    to,
    subject,
    body: letter,
    attachmentName: cv?.filename || null,
    hasCv: Boolean(cv?.exists),
    gmailConnected: Boolean(gmail?.connected),
    gmailUser: gmail?.userEmail || null,
    organization: opp.organization || '',
    title: opp.title
  };
}

export async function sendApplicationEmail({
  userId,
  opportunityId,
  applicationId,
  confirmed,
  to,
  subject,
  body
}) {
  if (confirmed !== true) {
    const err = new Error('Confirmation explicite requise. Aucun e-mail n’a été envoyé.');
    err.status = 400;
    throw err;
  }
  const recipient = String(to || '').trim();
  if (!recipient || !recipient.includes('@')) {
    const err = new Error('Destinataire e-mail invalide.');
    err.status = 400;
    throw err;
  }

  let opp = null;
  let app = applicationId ? await Application.findById(applicationId) : null;
  if (app) opp = await Opportunity.findById(app.opportunity).lean();
  if (!opp && opportunityId) opp = await Opportunity.findById(opportunityId).lean();
  if (!opp) {
    const err = new Error('Offre introuvable.');
    err.status = 404;
    throw err;
  }

  const letter = stripMarkdown(String(body || '').trim());
  if (!letter) {
    const err = new Error('Le corps de l’e-mail est vide.');
    err.status = 400;
    throw err;
  }
  const emailSubject = String(subject || `Candidature — ${opp.title}`).trim();
  const cv = await loadCvAttachment(userId);
  if (!cv?.exists) {
    const err = new Error('CV introuvable. Importez le CV (ex. True CV COURBON.docx) avant l’envoi.');
    err.status = 400;
    throw err;
  }

  const gmail = await getGmailStatus(userId);
  if (!gmail?.connected) {
    const err = new Error('Gmail n’est pas connecté. Ouvrez Messagerie pour lier le compte.');
    err.status = 400;
    throw err;
  }

  const html = letterToHtml(letter);
  const gmailResult = await sendMessage(userId, {
    to: recipient,
    subject: emailSubject,
    body: html,
    attachments: [
      {
        filename: cv.filename,
        mimeType: cv.mimeType,
        contentBase64: cv.contentBase64
      }
    ]
  });

  if (!app) {
    app = await Application.findOne({ opportunity: opp._id });
  }
  if (!app) {
    app = await Application.create({
      opportunity: opp._id,
      status: 'submitted',
      notes: `Candidature envoyée à ${recipient}`
    });
  }

  app.status = 'submitted';
  app.appliedDate = new Date();
  app.letterText = letter;
  app.contactPerson = { ...(app.contactPerson?.toObject?.() || app.contactPerson || {}), email: recipient };
  app.sentEmail = {
    to: recipient,
    subject: emailSubject,
    body: letter,
    attachmentName: cv.filename,
    gmailMessageId: gmailResult?.id || '',
    sentAt: new Date()
  };
  await app.save();
  const populated = await app.populate('opportunity');
  return { application: populated, gmailMessageId: gmailResult?.id || null };
}
