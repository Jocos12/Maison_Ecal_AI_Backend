import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';
import { callAIWithFallback } from './aiService.js';
import { searchJobsWithAI } from './jobSearchService.js';
import { renderDocumentPdf } from './jobDocumentPdfService.js';
import JobAssistantDocument from '../models/JobAssistantDocument.js';
import JobApplicationLog from '../models/JobApplicationLog.js';
import { sendMessage } from './gmailService.js';
import {
  extractSearchParams,
  isClarificationOnly,
  shouldRunSearch
} from './jobContextService.js';
import { detectMessageLanguage } from '../utils/detectMessageLanguage.js';
import {
  buildJobAssistantSystemPrompt,
  buildJobSearchSummaryPrompt,
  JOB_DOCUMENT_CV_PROMPT,
  JOB_DOCUMENT_LETTER_PROMPT
} from '../prompts/jobAssistantPrompt.js';
import logger from '../utils/logger.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
export const JOB_DOCS_DIR = path.join(__dirname, '../../uploads/job-assistant');

async function ensureDocsDir() {
  await fs.mkdir(JOB_DOCS_DIR, { recursive: true });
}

async function safeCallAIWithFallback(prompt, systemPrompt, maxTokens) {
  try {
    return await callAIWithFallback(prompt, systemPrompt, maxTokens);
  } catch (err) {
    logger.warn(`Tous les providers IA ont échoué — bascule locale: ${err.message}`);
    return null;
  }
}

async function safeCallAIText(prompt, systemPrompt, maxTokens) {
  const result = await safeCallAIWithFallback(prompt, systemPrompt, maxTokens);
  return result?.text?.trim() || null;
}

function buildOfflineDocument(type, job, profile = {}, mode) {
  const name = profile.fullName || profile.director || 'Candidat M-ECAL';
  const email = profile.email || 'contact@mecal.rdc';
  const phone = profile.phone || '+243';
  const city = job?.city || 'Kinshasa';
  const org = job?.organization || 'Organisation';
  const title = job?.title || 'Poste logistique';
  const today = new Date().toLocaleDateString('fr-FR', {
    day: 'numeric',
    month: 'long',
    year: 'numeric'
  });

  if (type === 'letter') {
    return `${city}, le ${today}

Objet : Candidature — ${title}

Madame, Monsieur,

Fort de mon expérience en logistique et supply chain en République Démocratique du Congo, je souhaite vous présenter ma candidature pour le poste de ${title} au sein de ${org}.

${profile.experience || profile.description || 'Mon parcours couvre la formation logistique, la consultance, l\'inventaire et l\'assistance opérationnelle sur le territoire congolais.'}

Maîtrisant les enjeux du terrain en RDC (Kinshasa, Lubumbashi, Goma, Bukavu, Kalemie), je suis convaincu(e) de pouvoir apporter une valeur ajoutée immédiate à votre organisation dans le cadre de cette mission.

Dans l'attente de votre retour, je vous prie d'agréer, Madame, Monsieur, l'expression de mes salutations distinguées.

${name}
${phone} | ${email}`;
  }

  const correction = mode === 'correct' ? ' — version optimisée' : '';
  const skills = Array.isArray(profile.skills)
    ? profile.skills
    : Array.isArray(profile.services)
      ? profile.services
      : ['Gestion logistique', 'Inventaire', 'Supply chain RDC'];

  return `${name.toUpperCase()}
${profile.title || 'Consultant(e) Logistique & Supply Chain'}${correction}
${phone} | ${email} | ${city}, RDC

PROFIL
${profile.summary || profile.description || 'Professionnel(le) de la logistique en RDC, spécialisé(e) en formation, consultance, inventaire et assistance opérationnelle.'}

EXPÉRIENCE
${profile.experience || 'Expériences significatives en logistique humanitaire et commerciale en RDC.'}

FORMATION
${profile.education || profile.formation || 'Formation en logistique / gestion de la supply chain.'}

COMPÉTENCES
${skills.slice(0, 8).map((s) => `• ${s}`).join('\n')}

LANGUES
Français (courant)${profile.languages ? `, ${profile.languages}` : ', Anglais (professionnel)'}

RÉFÉRENCES
${profile.projectReferences || profile.references || 'Sur demande'}`;
}

export async function chatWithJobAssistant({ messages = [], locale = 'fr', systemPrompt = null } = {}) {
  const history = messages
    .filter((m) => m.role === 'user' || m.role === 'assistant')
    .slice(-40)
    .map((m) => `${m.role === 'user' ? 'Utilisateur' : 'Assistant'}: ${m.content}`)
    .join('\n');

  const chatRules = `
RAPPEL : Tu ne dois JAMAIS inventer d'offres d'emploi, d'organisations, de liens ou de dates.
Si l'utilisateur demande des offres, une recherche réelle sera lancée séparément — ne cite aucune offre concrète ici.
Réponds directement et brièvement à la question. Utilise l'historique pour le contexte (ville, poste déjà mentionnés).`;

  const prompt = `${history ? `Historique complet de la conversation:\n${history}\n\n` : ''}${chatRules}`;

  const baseSystemPrompt = buildJobAssistantSystemPrompt(undefined, locale);
  const mergedSystemPrompt = systemPrompt
    ? `${baseSystemPrompt}\n\n${systemPrompt}`
    : baseSystemPrompt;

  const result = await safeCallAIWithFallback(prompt, mergedSystemPrompt, 2000);
  if (result) {
    return { reply: result.text, provider: result.provider };
  }

  const lastUser = [...messages].reverse().find((m) => m.role === 'user')?.content || '';
  const offlineIntro =
    locale === 'en'
      ? `I'm the M-ECAL agent (local mode — Claude, Groq and Gemini unavailable).\n\nI can still help you:\n• **Search jobs** logistics DRC\n• **Generate / fix CV** and cover letters (PDF)\n• **Apply** and track applications\n• **Answer** about M-ECAL menu and pages\n\n`
      : `Je suis l'agent M-ECAL (mode local — Claude, Groq et Gemini indisponibles).\n\nJe peux quand même vous aider :\n• **Chercher des offres** logistique RDC\n• **Générer / corriger CV** et lettres (PDF)\n• **Postuler** et analyser vos candidatures\n• **Répondre** sur le menu et les pages M-ECAL\n\n`;
  return {
    reply:
      offlineIntro +
      (lastUser
        ? locale === 'en'
          ? `Your question: « ${lastUser.slice(0, 120)} »\n\nRephrase or use the quick action buttons above.`
          : `Votre question : « ${lastUser.slice(0, 120)} »\n\nReformulez ou utilisez les boutons rapides ci-dessus.`
        : locale === 'en'
          ? 'Rephrase or use the quick action buttons above.'
          : 'Reformulez ou utilisez les boutons rapides ci-dessus.'),
    provider: 'local'
  };
}

export async function processConversationMessage({
  messages = [],
  userMessage,
  sources = null,
  locale: localeOverride = null,
  systemPrompt = null
} = {}) {
  const history = messages.filter((m) => m.role === 'user' || m.role === 'assistant');
  const priorMessages = history.slice(0, -1);
  const locale = localeOverride || detectMessageLanguage(userMessage, history);

  if (shouldRunSearch(userMessage, priorMessages)) {
    const { query, city, role, allRdc, broadenSearch } = extractSearchParams(
      priorMessages,
      userMessage
    );
    logger.info(
      `[JobAssistant] Recherche: query="${query}" city="${city || 'toutes'}" role="${role}" allRdc=${allRdc}`
    );

    const userNeed = [role, allRdc ? 'toutes villes RDC' : city, userMessage]
      .filter(Boolean)
      .join(' — ');

    const searchResult = await searchJobsWithAI({
      query,
      city,
      role,
      allRdc,
      broadenSearch,
      userNeed,
      sources,
      locale
    });
    return {
      content: searchResult.message,
      jobs: searchResult.jobs,
      noResults: searchResult.noResults,
      sourceAlerts: searchResult.sourceAlerts,
      sources: searchResult.sources,
      suggestions: searchResult.suggestions || [],
      manualLinks: searchResult.manualLinks || [],
      diagnosis: searchResult.diagnosis,
      provider: searchResult.provider,
      isSearch: true
    };
  }

  if (isClarificationOnly(userMessage)) {
    const city = extractSearchParams(priorMessages, userMessage).city;
    const role = extractSearchParams(priorMessages, userMessage).role;
    const parts = [];
    if (city) {
      parts.push(
        locale === 'en' ? `City in context: ${city}.` : `Ville en contexte : ${city}.`
      );
    }
    if (role) {
      parts.push(locale === 'en' ? `Role in context: ${role}.` : `Poste en contexte : ${role}.`);
    }
    if (!parts.length) {
      parts.push(
        locale === 'en'
          ? 'Specify an RDC city (e.g. Kinshasa, Bukavu, Goma) to refine the search.'
          : 'Précisez la ville en RDC (ex. Kinshasa, Bukavu, Goma) pour affiner la recherche.'
      );
    }
    return { content: parts.join(' '), isSearch: false, provider: 'context' };
  }

  const { reply, provider } = await chatWithJobAssistant({ messages: history, locale, systemPrompt });
  return { content: reply, provider, isSearch: false };
}

export async function generateJobDocument({ userId, type, job, profile, mode, locale = 'fr' }) {
  if (!['cv', 'letter'].includes(type)) {
    throw new Error('Type de document invalide (cv ou letter).');
  }
  if (!job?.title) {
    throw new Error('Offre cible requise.');
  }

  const docPrompt =
    type === 'cv' ? JOB_DOCUMENT_CV_PROMPT : JOB_DOCUMENT_LETTER_PROMPT;
  const correctionNote =
    mode === 'correct' && type === 'cv'
      ? '\n\nMODE CORRECTION : améliore, structure et optimise le CV à partir du profil (formulation professionnelle, clarté, mots-clés logistique / supply chain RDC). Corrige les faiblesses sans inventer de fausses expériences.'
      : '';

  const userPrompt = `${docPrompt}${correctionNote}

OFFRE :
- Poste : ${job.title}
- Organisation : ${job.organization || 'N/A'}
- Ville : ${job.city || 'RDC'}
- Lien : ${job.sourceUrl || 'N/A'}

PROFIL UTILISATEUR :
${JSON.stringify(profile || {}, null, 2)}`;

  const textContent =
    (await safeCallAIText(userPrompt, buildJobAssistantSystemPrompt(undefined, locale), 2500)) ||
    buildOfflineDocument(type, job, profile || {}, mode);

  await ensureDocsDir();
  const safeTitle = (job.title || 'document').replace(/[^\w\s-]/g, '').slice(0, 40);
  const fileName = `${type}-${safeTitle}-${Date.now()}.pdf`;
  const filePath = path.join(JOB_DOCS_DIR, fileName);

  await renderDocumentPdf({
    filePath,
    title: type === 'cv' ? `CV — ${job.title}` : `Lettre de motivation — ${job.title}`,
    content: textContent,
    type
  });

  const doc = await JobAssistantDocument.create({
    userId,
    documentType: type,
    jobTitle: job.title,
    organization: job.organization || '',
    sourceUrl: job.sourceUrl || '',
    city: job.city || '',
    textContent,
    filePath,
    fileName,
    status: 'generated',
    confirmedForSend: false
  });

  return {
    documentId: doc._id,
    fileName: doc.fileName,
    downloadUrl: `/api/job-assistant/documents/${doc._id}/download`,
    textContent,
    preview: textContent.slice(0, 500) + (textContent.length > 500 ? '…' : ''),
    message:
      'Document généré. Téléchargez-le ci-dessous. Aucun envoi automatique — utilisez le bouton de confirmation pour soumettre.'
  };
}

export async function submitJobApplication({
  userId,
  confirmed,
  documentId,
  job,
  to,
  subject,
  body
}) {
  if (confirmed !== true) {
    throw new Error(
      'Confirmation explicite requise (confirmed: true). Aucun envoi sans action utilisateur.'
    );
  }

  const doc = await JobAssistantDocument.findOne({ _id: documentId, userId });
  if (!doc) {
    throw new Error('Document introuvable.');
  }
  if (doc.status === 'submitted') {
    throw new Error('Cette candidature a déjà été envoyée.');
  }

  const recipient = to || '';
  if (!recipient) {
    throw new Error('Destinataire email requis pour l\'envoi.');
  }

  const emailSubject =
    subject || `Candidature — ${job?.title || doc.jobTitle}`;
  const emailBody =
    body ||
    `<p>Bonjour,</p><p>Veuillez trouver ci-joint ma candidature pour le poste de <strong>${doc.jobTitle}</strong>.</p><p>Cordialement</p>`;

  let gmailResult = null;
  try {
    gmailResult = await sendMessage(userId, {
      to: recipient,
      subject: emailSubject,
      body: `${emailBody}<p><em>Document : ${doc.fileName} (généré via Assistant Emploi M-ECAL)</em></p>`
    });
  } catch (e) {
    logger.warn(`[JobAssistant] Gmail send failed: ${e.message}`);
    throw new Error(
      `Envoi Gmail impossible : ${e.message}. Connectez Gmail dans Messagerie.`
    );
  }

  doc.status = 'submitted';
  doc.confirmedForSend = true;
  await doc.save();

  const log = await JobApplicationLog.create({
    userId,
    documentId: doc._id,
    jobTitle: job?.title || doc.jobTitle,
    organization: job?.organization || doc.organization,
    sourceUrl: job?.sourceUrl || doc.sourceUrl,
    documentType: doc.documentType,
    documentFileName: doc.fileName,
    recipientEmail: recipient,
    subject: emailSubject,
    submittedAt: new Date(),
    method: 'gmail',
    gmailMessageId: gmailResult?.id || null
  });

  return {
    success: true,
    logId: log._id,
    message: `Candidature envoyée à ${recipient}.`,
    recap: {
      to: recipient,
      subject: emailSubject,
      attachment: doc.fileName,
      jobTitle: log.jobTitle,
      organization: log.organization
    }
  };
}

export async function getSubmissionHistory(userId) {
  return JobApplicationLog.find({ userId })
    .sort({ submittedAt: -1 })
    .limit(50)
    .lean();
}

export { searchJobsWithAI };
