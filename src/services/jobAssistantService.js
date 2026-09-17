import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';
import { callAIWithFallback, isComplexAiTask } from './aiService.js';
import { searchJobsWithAI } from './jobSearchService.js';
import { renderDocumentPdf, isPlaceholderJobTitle, documentHeading } from './jobDocumentPdfService.js';
import JobAssistantDocument from '../models/JobAssistantDocument.js';
import JobApplicationLog from '../models/JobApplicationLog.js';
import { getJobAssistantProfile } from './jobAssistantProfileService.js';
import { sendMessage } from './gmailService.js';
import {
  extractSearchParams,
  isClarificationOnly,
  shouldRunSearch
} from './jobContextService.js';
import { detectMessageLanguage } from '../utils/detectMessageLanguage.js';
import { ensureMaisonEcalMention } from '../utils/maisonEcalLetter.js';
import { stripMarkdown } from '../utils/stripMarkdown.js';
import { answerInLocalMode } from './localModeAssistant.js';
import {
  buildJobAssistantSystemPrompt,
  buildJobSearchSummaryPrompt,
  JOB_DOCUMENT_CV_PROMPT,
  JOB_DOCUMENT_LETTER_PROMPT,
  JOB_DOCUMENT_RECO_PROMPT,
  JOB_DOCUMENT_CV_REVIEW_PROMPT
} from '../prompts/jobAssistantPrompt.js';
import logger from '../utils/logger.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
export const JOB_DOCS_DIR = path.join(__dirname, '../../uploads/job-assistant');

function formatJobsForChat(jobs = []) {
  if (!jobs?.length) return '';
  return jobs
    .slice(0, 18)
    .map(
      (j, i) =>
        `${i + 1}. ${j.title} | org: ${j.organization || '—'} | ville: ${j.city || '—'} | source: ${j.platform || j.source || '—'} | lien: ${j.sourceUrl || 'N/A'}`
    )
    .join('\n');
}

function collectConversationJobs(messages = []) {
  const seen = new Set();
  const jobs = [];
  for (const m of messages) {
    for (const job of m.jobs || []) {
      const key = job.sourceUrl || `${job.title}|${job.organization}`;
      if (seen.has(key)) continue;
      seen.add(key);
      jobs.push(job);
    }
  }
  return jobs;
}

const CV_FIX_INTENT = /corrige.{0,20}cv|correct.{0,20}cv|am[ée]liore.{0,20}cv|fix.{0,12}cv|revise.{0,12}cv/i;
const RECO_INTENT = /lettre de recommandation|recommendation letter|lettre de r[ée]f[ée]rence/i;

async function ensureDocsDir() {
  await fs.mkdir(JOB_DOCS_DIR, { recursive: true });
}

async function safeCallAIWithFallback(prompt, systemPrompt, maxTokens, options = {}) {
  try {
    return await callAIWithFallback(prompt, systemPrompt, maxTokens, options);
  } catch (err) {
    logger.warn(`Tous les providers IA ont échoué — bascule locale: ${err.message}`);
    return null;
  }
}

async function safeCallAIText(prompt, systemPrompt, maxTokens, options = {}) {
  const result = await safeCallAIWithFallback(prompt, systemPrompt, maxTokens, options);
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

export async function chatWithJobAssistant({
  messages = [],
  locale = 'fr',
  systemPrompt = null,
  userId = null
} = {}) {
  const history = messages
    .filter((m) => m.role === 'user' || m.role === 'assistant')
    .slice(-40)
    .map((m) => `${m.role === 'user' ? 'Utilisateur' : 'Assistant'}: ${m.content}`)
    .join('\n');

  const lastUser = [...messages].reverse().find((m) => m.role === 'user')?.content || '';
  const knownJobs = collectConversationJobs(messages);
  const jobsBlock = formatJobsForChat(knownJobs);
  const complex = isComplexAiTask(lastUser);
  const chatRules = `
PRIORITÉ : réponds D'ABORD (1-2 phrases) à la question actuelle, en tenant compte de l'historique (ville, poste, « are you sure », etc.). Ne redemande pas des précisions génériques si le contexte suffit.

OFFRES RÉELLES déjà trouvées dans cette conversation (tu PEUX et DOIS les citer ; n'invente RIEN hors de cette liste) :
${jobsBlock || '(aucune offre listée pour l’instant — n’invente pas d’offre ; propose de lancer une recherche si besoin)'}

Si la question vérifie un lieu (ex. Bukavu), filtre ces offres par ville et confirme ou infirme avec titres + sources.
N'invente jamais d'organisation, de lien ou de date.`;

  const prompt = `${history ? `Historique de la conversation:\n${history}\n\n` : ''}QUESTION ACTUELLE:\n${lastUser}\n\n${chatRules}`;

  const baseSystemPrompt = buildJobAssistantSystemPrompt(undefined, locale);
  const mergedSystemPrompt = systemPrompt
    ? `${baseSystemPrompt}\n\n${systemPrompt}`
    : baseSystemPrompt;

  const result = await safeCallAIWithFallback(
    prompt,
    mergedSystemPrompt,
    complex ? 4096 : 2048,
    { mode: 'full' }
  );
  if (result) {
    return { reply: result.text, provider: result.provider };
  }

  const local = await answerInLocalMode({
    messages,
    lastUser,
    locale,
    userId,
    knownJobs
  });
  return {
    reply: local.reply,
    provider: 'local',
    jobs: local.jobs || []
  };
}

export async function processConversationMessage({
  messages = [],
  userMessage,
  sources = null,
  locale: localeOverride = null,
  systemPrompt = null,
  userId = null
} = {}) {
  const history = messages.filter((m) => m.role === 'user' || m.role === 'assistant');
  const priorMessages = history.slice(0, -1);
  const locale = localeOverride || detectMessageLanguage(userMessage, history);
  const knownJobs = collectConversationJobs(history);
  const lastJob = knownJobs[0] || null;

  if (userId && CV_FIX_INTENT.test(userMessage)) {
    const { profile, cv } = await getJobAssistantProfile(userId);
    const hasCv = Boolean(profile.fullName || profile.experience || cv?.fileName);
    if (!hasCv) {
      return {
        content:
          locale === 'en'
            ? 'Import your CV first (same file as the dashboard Agent, e.g. True CV COURBON.docx), then ask me to correct it.'
            : 'Importez d’abord votre CV (le même que sur l’Agent du dashboard, ex. True CV COURBON.docx), puis redemandez « corrige mon CV ».',
        isSearch: false,
        provider: 'context'
      };
    }
    const review = await safeCallAIText(
      `${JOB_DOCUMENT_CV_REVIEW_PROMPT}\n\nCV importé : ${cv?.fileName || 'profil'}\n\nPROFIL:\n${JSON.stringify(profile, null, 2)}`,
      buildJobAssistantSystemPrompt(undefined, locale),
      1800,
      { mode: 'full' }
    );
    const suggestions =
      review ||
      'Suggestions rapides : 1) Accroche ciblée logistique RDC. 2) Verbes d’action dans l’expérience. 3) Dates cohérentes. 4) Compétences mesurables.';
    try {
      const doc = await generateJobDocument({
        userId,
        type: 'cv',
        job: lastJob || { title: 'Profil logistique M-ECAL', organization: 'Maison ECAL', city: 'RDC' },
        profile,
        mode: 'correct',
        locale
      });
      return {
        content: `${suggestions}\n\nUne version corrigée du CV est prête au téléchargement.`,
        document: doc,
        provider: doc.provider || 'ai',
        isSearch: false
      };
    } catch (err) {
      return { content: suggestions, isSearch: false, provider: 'ai' };
    }
  }

  if (RECO_INTENT.test(userMessage)) {
    const nameMatch = userMessage.match(
      /(?:recommandataire|recommander|de la part de|from)\s*[:\-]?\s*([A-ZÀ-Ÿ][a-zà-ÿ]+(?:\s+[A-ZÀ-Ÿ][a-zà-ÿ]+){0,3})/i
    );
    const recommenderName = nameMatch?.[1]?.trim();
    if (!recommenderName) {
      return {
        content:
          locale === 'en'
            ? 'To draft a recommendation letter I need: (1) recommender full name, (2) their role/organisation, (3) relationship and period (e.g. manager at X, 2022–2024). Reply with those three points.'
            : 'Pour une lettre de recommandation, indiquez : (1) le nom du recommandataire, (2) sa fonction / organisation, (3) le contexte (lien, période). Ex. « Recommandataire : Marie Kabila, coordinatrice logistique UNICEF, manager de 2022 à 2024 ».',
        isSearch: false,
        provider: 'context'
      };
    }
    if (userId) {
      const { profile } = await getJobAssistantProfile(userId);
      const doc = await generateJobDocument({
        userId,
        type: 'recommendation',
        job: lastJob || { title: 'Mission logistique', organization: 'Organisation partenaire', city: 'RDC' },
        profile,
        locale,
        extra: { recommenderName, context: userMessage }
      });
      return {
        content: doc.message,
        document: doc,
        isSearch: false,
        provider: 'ai'
      };
    }
  }

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

  const { reply, provider, jobs: localJobs } = await chatWithJobAssistant({
    messages: history,
    locale,
    systemPrompt,
    userId
  });
  return { content: reply, provider, isSearch: false, jobs: localJobs || [] };
}

export async function generateJobDocument({
  userId,
  type,
  job,
  profile,
  mode,
  locale = 'fr',
  extra = {}
}) {
  if (!['cv', 'letter', 'recommendation'].includes(type)) {
    throw new Error('Type de document invalide (cv, letter ou recommendation).');
  }

  let stored = { profile: {}, cv: null };
  if (userId) {
    try {
      stored = await getJobAssistantProfile(userId);
    } catch {
      stored = { profile: {}, cv: null };
    }
  }
  const mergedProfile = { ...(stored.profile || {}), ...(profile || {}) };
  const placeholder = isPlaceholderJobTitle(job?.title);
  const targetJob =
    job?.title && !placeholder
      ? job
      : {
          title: type === 'cv' ? 'Profil logistique' : 'Candidature logistique',
          organization: job?.organization && !placeholder ? job.organization : '',
          city: job?.city || 'RDC',
          sourceUrl: placeholder ? '' : job?.sourceUrl || ''
        };

  if (type === 'letter' && (!job?.title || placeholder)) {
    throw new Error('Sélectionnez une offre réelle (pas un lien de plateforme) pour générer la lettre.');
  }

  if (type === 'recommendation') {
    if (!extra.recommenderName || !String(extra.context || extra.recommenderName).trim()) {
      const err = new Error(
        'Pour une lettre de recommandation, indiquez le nom du recommandataire et le contexte (fonction, lien, période).'
      );
      err.status = 400;
      err.code = 'NEED_RECO_INFO';
      throw err;
    }
  }

  const docPrompt =
    type === 'cv'
      ? JOB_DOCUMENT_CV_PROMPT
      : type === 'recommendation'
        ? JOB_DOCUMENT_RECO_PROMPT
        : JOB_DOCUMENT_LETTER_PROMPT;
  const correctionNote =
    mode === 'correct' && type === 'cv'
      ? '\n\nMODE CORRECTION : améliore formulations, structure et clarté à partir du CV importé. Ne change aucune date, employeur, diplôme ou compétence factuelle. N’invente rien.'
      : '';

  const userPrompt = `${docPrompt}${correctionNote}

OFFRE / CIBLE :
- Poste : ${targetJob.title}
- Organisation : ${targetJob.organization || 'N/A'}
- Ville : ${targetJob.city || 'RDC'}
- Lien : ${targetJob.sourceUrl || 'N/A'}

CV IMPORTÉ : ${stored.cv?.fileName || mergedProfile.cvFileName || 'profil saisi manuellement'}

PROFIL UTILISATEUR (ne pas dénaturer les faits) :
${JSON.stringify(mergedProfile, null, 2)}

${type === 'recommendation' ? `RECOMMANDATAIRE : ${extra.recommenderName}\nCONTEXTE : ${extra.context || extra.recommenderRole || ''}` : ''}`;

  const textContentRaw =
    (await safeCallAIText(userPrompt, buildJobAssistantSystemPrompt(undefined, locale), 4096, {
      mode: 'full'
    })) ||
    buildOfflineDocument(type === 'recommendation' ? 'letter' : type, targetJob, mergedProfile, mode);

  let textContent = stripMarkdown(textContentRaw);
  if (type === 'letter' || type === 'recommendation') {
    textContent = ensureMaisonEcalMention(textContent);
  }

  await ensureDocsDir();
  const fileName = `${type}-${Date.now()}.pdf`;
  const filePath = path.join(JOB_DOCS_DIR, fileName);

  await renderDocumentPdf({
    filePath,
    title: documentHeading(type),
    content: textContent,
    type: type === 'cv' ? 'cv' : type === 'recommendation' ? 'recommendation' : 'letter',
    jobTitle: placeholder ? '' : targetJob.title,
    organization: targetJob.organization || ''
  });

  const doc = await JobAssistantDocument.create({
    userId,
    documentType: type === 'recommendation' ? 'letter' : type,
    jobTitle: targetJob.title,
    organization: targetJob.organization || '',
    sourceUrl: targetJob.sourceUrl || '',
    city: targetJob.city || '',
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
      type === 'cv'
        ? 'CV PDF généré à partir du CV importé. Téléchargez le fichier — aucun envoi automatique.'
        : type === 'recommendation'
          ? 'Lettre de recommandation PDF générée (mention Maison ECAL). Téléchargez le fichier.'
          : 'Lettre de motivation PDF générée (mention Maison ECAL). Téléchargez le fichier.'
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
