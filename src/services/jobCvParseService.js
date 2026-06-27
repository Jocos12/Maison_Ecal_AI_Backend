import { callAIForJSON } from './aiService.js';
import logger from '../utils/logger.js';

const CV_PARSE_SYSTEM = `Tu extrais les informations d'un CV pour préremplir un profil candidat logistique en RDC.
RÈGLES :
- N'invente AUCUNE information absente du texte du CV.
- Si un champ est introuvable, renvoie une chaîne vide "".
- experience : résumé structuré des postes (intitulé, organisation, dates, missions clés).
- education : diplômes et formations.
- skills : compétences techniques et soft skills, séparées par des virgules.
Réponds UNIQUEMENT en JSON valide avec ces clés exactes :
{ "fullName": "", "email": "", "phone": "", "education": "", "experience": "", "skills": "" }`;

function extractEmail(text) {
  const m = text.match(/[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/);
  return m ? m[0] : '';
}

function extractPhone(text) {
  const patterns = [
    /(?:\+|00)?243[\s.-]?\d{2}[\s.-]?\d{3}[\s.-]?\d{3,4}/,
    /(?:\+|00)?243[\s.-]?\d{9}/,
    /0\d{2}[\s.-]?\d{3}[\s.-]?\d{3,4}/,
    /\+\d{1,3}[\s.-]?\d{6,14}/
  ];
  for (const re of patterns) {
    const m = text.match(re);
    if (m) return m[0].replace(/\s+/g, ' ').trim();
  }
  return '';
}

function extractNameHeuristic(text) {
  const lines = text
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l.length > 2 && l.length < 80);
  for (const line of lines.slice(0, 8)) {
    if (/@|http|linkedin|curriculum|resume|cv\b|téléphone|phone|email/i.test(line)) continue;
    if (/^\d{4}/.test(line)) continue;
    if (/^[A-ZÀ-Ÿ][a-zà-ÿ]+(\s+[A-ZÀ-Ÿ][a-zà-ÿ]+){1,4}$/.test(line)) return line;
    if (/^[A-ZÀ-Ÿ\s'-]{4,}$/.test(line) && line.split(/\s+/).length <= 5) return line;
  }
  return '';
}

function extractSection(text, headers) {
  const pattern = new RegExp(
    `(?:${headers.join('|')})\\s*[:\\-]?\\s*([\\s\\S]{0,2500}?)(?=\\n\\s*(?:${headers.join('|')})\\s*[:\\-]?|\\n\\s*\\n|$)`,
    'i'
  );
  const m = text.match(pattern);
  return m ? m[1].replace(/\s+/g, ' ').trim().slice(0, 2000) : '';
}

function heuristicParseCv(text) {
  const education = extractSection(text, [
    'formation',
    'éducation',
    'education',
    'diplôme',
    'diplome',
    'études',
    'etudes',
    'academic'
  ]);
  const experience = extractSection(text, [
    'expérience',
    'experience',
    'parcours professionnel',
    'emplois',
    'work experience',
    'professional experience'
  ]);
  const skills = extractSection(text, [
    'compétences',
    'competences',
    'skills',
    'aptitudes',
    'savoir-faire'
  ]);

  return {
    fullName: extractNameHeuristic(text),
    email: extractEmail(text),
    phone: extractPhone(text),
    education,
    experience,
    skills
  };
}

function normalizeProfile(raw = {}) {
  const fields = ['fullName', 'email', 'phone', 'education', 'experience', 'skills', 'languages'];
  const out = {};
  for (const key of fields) {
    out[key] = String(raw[key] || '').trim();
  }
  return out;
}

function mergeProfiles(existing = {}, extracted = {}, { replace = false } = {}) {
  const merged = { ...existing };
  for (const [key, value] of Object.entries(extracted)) {
    if (!value) continue;
    if (replace || !merged[key]?.trim()) {
      merged[key] = value;
    }
  }
  return normalizeProfile(merged);
}

export async function parseCvTextToProfile(cvText, { existingProfile = {} } = {}) {
  const text = String(cvText || '').trim();
  if (text.length < 40) {
    throw new Error('Le CV ne contient pas assez de texte lisible (minimum ~40 caractères).');
  }

  const heuristic = heuristicParseCv(text);
  let extracted = heuristic;

  try {
    const snippet = text.slice(0, 12000);
    const { data } = await callAIForJSON(
      `Extrais les informations du CV ci-dessous :\n\n---\n${snippet}\n---`,
      CV_PARSE_SYSTEM
    );
    extracted = normalizeProfile({
      fullName: data.fullName || heuristic.fullName,
      email: data.email || heuristic.email,
      phone: data.phone || heuristic.phone,
      education: data.education || heuristic.education,
      experience: data.experience || heuristic.experience,
      skills: data.skills || heuristic.skills
    });
    logger.info('[JobAssistant] Profil extrait du CV via IA');
  } catch (e) {
    logger.warn(`[JobAssistant] Extraction IA CV échouée, heuristiques: ${e.message}`);
    extracted = normalizeProfile(heuristic);
  }

  const profile = mergeProfiles(existingProfile, extracted, { replace: true });
  const filledCount = Object.values(profile).filter((v) => v.length > 1).length;

  return {
    profile,
    extracted,
    filledCount,
    method: extracted.fullName || extracted.experience ? 'ai_or_heuristic' : 'heuristic'
  };
}

export { mergeProfiles, normalizeProfile };

function guessMimeFromName(name = '') {
  const lower = name.toLowerCase();
  if (lower.endsWith('.pdf')) return 'application/pdf';
  if (lower.endsWith('.docx')) {
    return 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
  }
  if (lower.endsWith('.txt')) return 'text/plain';
  return '';
}

export async function extractTextFromCvFile(buffer, { originalName = '', mimeType = '' } = {}) {
  const name = originalName.toLowerCase();
  const mime = (mimeType || guessMimeFromName(originalName)).toLowerCase();

  if (mime === 'text/plain' || name.endsWith('.txt')) {
    return buffer.toString('utf8');
  }

  if (mime === 'application/pdf' || name.endsWith('.pdf')) {
    try {
      const mod = await import('pdf-parse');
      const pdfParse = mod.default || mod;
      const result = await pdfParse(buffer);
      return result?.text || '';
    } catch (e) {
      if (e.code === 'ERR_MODULE_NOT_FOUND') {
        throw new Error(
          'Module pdf-parse manquant — exécutez npm install dans le dossier backend.'
        );
      }
      throw new Error(`PDF illisible : ${e.message}`);
    }
  }

  if (
    mime === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' ||
    name.endsWith('.docx')
  ) {
    try {
      const mammothMod = await import('mammoth');
      const mammoth = mammothMod.default || mammothMod;
      const result = await mammoth.extractRawText({ buffer });
      return result?.value || '';
    } catch (e) {
      if (e.code === 'ERR_MODULE_NOT_FOUND') {
        throw new Error(
          'Module mammoth manquant — exécutez npm install dans le dossier backend.'
        );
      }
      throw new Error(`DOCX illisible : ${e.message}`);
    }
  }

  throw new Error('Format non supporté. Utilisez PDF, DOCX ou TXT.');
}
