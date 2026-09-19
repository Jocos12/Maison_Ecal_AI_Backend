import SystemSetting from '../models/SystemSetting.js';
import logger from '../utils/logger.js';
import { hasAiProviders } from '../config/businessRules.js';
import { callAIForJSON, recordAiUsage } from './aiService.js';
import { DEFAULT_PROFILE } from '../routes/settings.js';

/**
 * Brief and draft answer for an NRC notice.
 * With an AI provider configured the text is written by the model; without one (or when it fails) a local mode
 * builds the brief from the facts found in the notice and its attached document, and the draft from a template
 * filled with the company profile. The local mode never invents facts: what is missing is left in [brackets].
 */

const LANG_NAME = { fr: 'français', en: 'English', sw: 'Kiswahili' };

const TEXTS = {
  fr: {
    expired: 'La date limite est dépassée : vérifiez auprès de NRC si des offres sont encore acceptées.',
    soon: (d) => `Il reste ${d} jour(s) avant la date limite : préparez le dossier sans attendre.`,
    noDeadline: 'Aucune date limite n’a été trouvée dans l’avis : confirmez-la auprès du contact NRC.',
    late: 'Les offres tardives ou incomplètes peuvent être rejetées.',
    noFinancial: 'Aucune offre financière n’est demandée à ce stade.',
    prequal: 'Il s’agit d’une présélection : NRC constitue une liste de prestataires qualifiés.',
    abroad: (c) => `L’appel concerne ${c} : M-ECAL intervient en RDC, vérifiez la faisabilité et l’éligibilité.`,
    workplace: (w) => `Mode de travail : ${w}.`,
    docsGeneric: 'Liste type à confirmer dans le dossier complet',
    fit: {
      high: 'Cette offre correspond bien aux services de M-ECAL.',
      medium: 'Cette offre correspond en partie aux services de M-ECAL.',
      low: 'Cette offre s’éloigne des services de M-ECAL.'
    },
    fitJob: {
      high: 'Ce poste correspond bien à un profil logistique.',
      medium: 'Ce poste correspond en partie à un profil logistique.',
      low: 'Ce poste s’éloigne d’un profil logistique.'
    },
    factors: {
      logistics_signals: 'Le texte contient des signaux logistiques (entrepôt, stock, transport, formation, étude).',
      mecal_category: 'L’avis relève d’une catégorie de service de M-ECAL.',
      goods_only: 'Il s’agit surtout d’un achat de biens ou de travaux.',
      drc: 'Le lieu est en RDC.',
      abroad: 'Le lieu est hors RDC.',
      weak_signals: 'Peu de signaux liés aux services de M-ECAL.',
      job_logistics_title: 'Le titre du poste est logistique / supply chain.',
      job_logistics_category: 'Le poste relève de la catégorie logistique de NRC.',
      job_logistics_text: 'La description mentionne des tâches logistiques.',
      job_other_domain: 'Le poste relève d’un autre domaine que la logistique.'
    },
    datePosted: 'Publication',
    dateDeadline: 'Date limite',
    genericDocsTender: ['Profil de l’entreprise et expérience pertinente', 'Documents d’enregistrement et attestation fiscale', 'Références de missions similaires'],
    genericDocsJob: ['CV à jour', 'Lettre de motivation', 'Références professionnelles']
  },
  en: {
    expired: 'The deadline has passed: check with NRC whether offers are still accepted.',
    soon: (d) => `${d} day(s) left before the deadline: start the file now.`,
    noDeadline: 'No deadline was found in the notice: confirm it with the NRC contact.',
    late: 'Late or incomplete submissions may be rejected.',
    noFinancial: 'No financial offer is requested at this stage.',
    prequal: 'This is a prequalification: NRC is building a list of qualified providers.',
    abroad: (c) => `The notice is about ${c}: M-ECAL operates in the DRC, check feasibility and eligibility.`,
    workplace: (w) => `Work arrangement: ${w}.`,
    docsGeneric: 'Standard list, to be confirmed in the full file',
    fit: {
      high: 'This notice matches M-ECAL’s services well.',
      medium: 'This notice partly matches M-ECAL’s services.',
      low: 'This notice is far from M-ECAL’s services.'
    },
    fitJob: {
      high: 'This position matches a logistics profile well.',
      medium: 'This position partly matches a logistics profile.',
      low: 'This position is far from a logistics profile.'
    },
    factors: {
      logistics_signals: 'The text contains logistics signals (warehouse, stock, transport, training, study).',
      mecal_category: 'The notice falls in one of M-ECAL’s service categories.',
      goods_only: 'It is mostly a purchase of goods or works.',
      drc: 'The location is in the DRC.',
      abroad: 'The location is outside the DRC.',
      weak_signals: 'Few signals related to M-ECAL’s services.',
      job_logistics_title: 'The job title is logistics / supply chain.',
      job_logistics_category: 'The position is in NRC’s logistics category.',
      job_logistics_text: 'The description mentions logistics tasks.',
      job_other_domain: 'The position belongs to a field other than logistics.'
    },
    datePosted: 'Published',
    dateDeadline: 'Deadline',
    genericDocsTender: ['Company profile and relevant experience', 'Registration and tax documents', 'References from similar assignments'],
    genericDocsJob: ['Up-to-date CV', 'Cover letter', 'Professional references']
  },
  sw: {
    expired: 'Tarehe ya mwisho imepita: thibitisha na NRC kama ofa bado zinapokelewa.',
    soon: (d) => `Siku ${d} zimebaki kabla ya tarehe ya mwisho: anza kuandaa faili sasa.`,
    noDeadline: 'Hakuna tarehe ya mwisho iliyopatikana kwenye tangazo: ithibitishe na mwasiliani wa NRC.',
    late: 'Maombi yaliyochelewa au pungufu yanaweza kukataliwa.',
    noFinancial: 'Hakuna ofa ya kifedha inayohitajika katika hatua hii.',
    prequal: 'Hii ni uchujaji wa awali: NRC inaunda orodha ya watoa huduma waliohitimu.',
    abroad: (c) => `Tangazo linahusu ${c}: M-ECAL inafanya kazi DRC, angalia uwezekano na ustahiki.`,
    workplace: (w) => `Mfumo wa kazi: ${w}.`,
    docsGeneric: 'Orodha ya kawaida, ithibitishwe kwenye faili kamili',
    fit: {
      high: 'Tangazo hili linalingana vizuri na huduma za M-ECAL.',
      medium: 'Tangazo hili linalingana kwa sehemu na huduma za M-ECAL.',
      low: 'Tangazo hili liko mbali na huduma za M-ECAL.'
    },
    fitJob: {
      high: 'Nafasi hii inalingana vizuri na wasifu wa usafirishaji.',
      medium: 'Nafasi hii inalingana kwa sehemu na wasifu wa usafirishaji.',
      low: 'Nafasi hii iko mbali na wasifu wa usafirishaji.'
    },
    factors: {
      logistics_signals: 'Maandishi yana ishara za usafirishaji (ghala, hisa, usafiri, mafunzo, utafiti).',
      mecal_category: 'Tangazo liko katika kundi la huduma za M-ECAL.',
      goods_only: 'Ni hasa ununuzi wa bidhaa au kazi za ujenzi.',
      drc: 'Mahali ni DRC.',
      abroad: 'Mahali ni nje ya DRC.',
      weak_signals: 'Ishara chache zinazohusiana na huduma za M-ECAL.',
      job_logistics_title: 'Jina la nafasi ni la usafirishaji / mnyororo wa ugavi.',
      job_logistics_category: 'Nafasi iko katika kundi la usafirishaji la NRC.',
      job_logistics_text: 'Maelezo yanataja kazi za usafirishaji.',
      job_other_domain: 'Nafasi ni ya fani tofauti na usafirishaji.'
    },
    datePosted: 'Imechapishwa',
    dateDeadline: 'Tarehe ya mwisho',
    genericDocsTender: ['Wasifu wa kampuni na uzoefu husika', 'Nyaraka za usajili na cheti cha kodi', 'Marejeo ya kazi zinazofanana'],
    genericDocsJob: ['CV ya kisasa', 'Barua ya maombi', 'Marejeo ya kitaaluma']
  }
};

const BOILERPLATE =
  /non-governmental|years of experience|advocates for the rights|norwegian refugee council \(nrc\) is|founded in|nrc has been operating|nrc is (a|an) |all nrc employees|join us in|dedicated, innovative|\bour values\b|equal opportunit|sexual|harassment|safeguarding|recognised for|internally displaced|about nrc|about the (role|position)/i;
const ASK_TENDER = /\b(must|shall|should|required?|requirements?|eligible|eligibility|capable|capacity|experience|able to|responsible for|provide|deliver|submit)\b/i;
const ASK_JOB = /\b(degree|diploma|bachelor|master|experience|years|fluent|fluency|knowledge|skills?|ability|proficien|certificate|required|essential)\b/i;
const DOCS = /\b(documents?|certificates?|registration|licen[cs]e|cv|resume|profile|references?|financial (offer|proposal)|technical (offer|proposal)|tax|bank|annex|form|brochure|portfolio|insurance|declaration|letter|photocopy|copy of)\b/i;

// Sentences about how offers are judged or sent, not documents to provide
const NOT_A_DOCUMENT = /will be evaluated|evaluation|criteria|scoring|no later than|deadline|submission email|should be titled|subject line|clarification/i;

const short = (text, max = 280) => {
  const t = String(text || '').replace(/^•\s*/, '').replace(/\s+/g, ' ').trim();
  return t.length > max ? `${t.slice(0, max - 1).trim()}…` : t;
};

/** The items listed right after a sentence such as "must submit the following documents" (bulleted or one per line). */
function itemsAfterLeadIn(lines, leadIn) {
  const i = lines.findIndex((l) => leadIn.test(l));
  if (i < 0) return [];
  const out = [];
  for (let k = i + 1; k < lines.length && out.length < 9; k += 1) {
    const line = lines[k];
    if (line.length > 260) break;
    if (out.length && (/:$/.test(line) || (line.length > 120 && /^(the|this|all|late|financial|shortlisted|please|requests?|for)\b/i.test(line)))) break;
    if (line.length >= 12) out.push(line);
  }
  return out;
}

const ASK_HEAD = /competenc|qualifications?|requirements?|skills,? knowledge|what we are looking for|your profile|experience and skills/i;

/** NRC vacancies follow one layout: purpose, responsibilities, competencies, closing notes. */
function jobSections(lines) {
  let purpose = '';
  const specific = [];
  const generic = [];
  const asks = [];
  const notes = [];
  let mode = '';
  for (const raw of lines) {
    const l = raw.trim();
    const bullet = l.startsWith('•');
    const text = l.replace(/^•\s*/, '');
    if (!bullet && l.length < 90 && !/[.!?]$/.test(l)) {
      if (/^roles? and responsibilities|^purpose|^about the (role|position)|^job purpose|^position summary/i.test(l)) mode = 'purpose';
      else if (/^specific responsibilities/i.test(l)) mode = 'specific';
      else if (/^generic responsibilities/i.test(l)) mode = 'generic';
      else if (ASK_HEAD.test(l)) mode = 'asks';
      else mode = 'other';
      continue;
    }
    if (/^(please|kindly) note\b/i.test(l)) {
      notes.push(text);
      continue;
    }
    if (mode === 'purpose' && !bullet && !purpose) purpose = text;
    else if (mode === 'specific' && bullet) specific.push(text);
    else if (mode === 'generic' && bullet) generic.push(text);
    else if (mode === 'asks' && bullet) asks.push(text);
  }
  return { purpose, responsibilities: specific.length ? specific : generic, asks, notes };
}

const linesOf = (text) =>
  String(text || '')
    .split(/\n+/)
    .flatMap((line) => (line.length > 320 ? line.split(/(?<=[.!?])\s+/) : [line]))
    .map((l) => l.trim())
    .filter((l) => l.length > 3);

const uniq = (arr) => [...new Set(arr.map((x) => short(x)).filter(Boolean))];

const fmtDate = (d, lang) =>
  d ? new Date(d).toLocaleDateString(lang === 'fr' ? 'fr-FR' : lang === 'sw' ? 'sw-KE' : 'en-GB', { day: 'numeric', month: 'long', year: 'numeric' }) : '';

const daysLeft = (deadline) => (deadline ? Math.ceil((new Date(deadline).getTime() - Date.now()) / 86400000) : null);

async function loadProfile() {
  const doc = await SystemSetting.findOne({ key: 'mecal_profile' }).lean();
  return { ...DEFAULT_PROFILE, ...(doc?.value || {}) };
}

// ------------------------------------------------------------------ brief

function attentionPoints(n, T, extra = []) {
  const text = `${n.description}\n${n.docText}`;
  const out = [];
  const left = daysLeft(n.deadline);
  if (left != null && left < 0) out.push(T.expired);
  else if (left != null && left <= 7) out.push(T.soon(Math.max(left, 0)));
  else if (left == null) out.push(T.noDeadline);
  const tender = n.kind === 'tender';
  if (tender && /late\b[^.]{0,60}(rejected|not be considered|disqualified)|incomplete[^.]{0,60}(rejected|not be considered)/i.test(text)) out.push(T.late);
  if (tender && /financial (offers?|proposals?)[^.]{0,50}(not|should not|must not)[^.]{0,30}(included|submitted|required)|no financial (offer|proposal)/i.test(text)) out.push(T.noFinancial);
  if (tender && /pre-?qualif/i.test(text)) out.push(T.prequal);
  if (n.kind === 'tender' && n.country && !n.isDrc) out.push(T.abroad(n.country));
  if (n.kind === 'job' && n.jobInfo?.workplace) out.push(T.workplace(n.jobInfo.workplace));
  out.push(...extra);
  return out;
}

function fitText(n, T) {
  const base = (n.kind === 'job' ? T.fitJob : T.fit)[n.scoreLabel || 'low'];
  const factors = (n.scoreFactors || []).map((f) => T.factors[f]).filter(Boolean);
  return [base, ...factors].join(' ');
}

function localBrief(n, lang) {
  const T = TEXTS[lang] || TEXTS.en;
  const isJob = n.kind === 'job';
  const lines = linesOf(`${n.description}\n${isJob ? '' : n.docText}`);
  const useful = lines.filter((l) => l.length > 35 && !BOILERPLATE.test(l) && !/^(qualifications?|requirements?|about|generic responsibilities|specific responsibilities)\b/i.test(l));
  const job = isJob ? jobSections(lines) : null;
  const jobSummary = job ? short([job.purpose, ...job.responsibilities.slice(0, 2)].filter(Boolean).join(' '), 620) : '';
  const summary = jobSummary || short(useful.slice(0, 3).join(' '), 620) || short(n.title);

  const askRe = isJob ? ASK_JOB : ASK_TENDER;
  const NOISE = /submission email|should be titled|subject line|email subject|telephone|^email|clarification|will be evaluated|this (call|is a)/i;
  let asks;
  if (isJob) {
    // The competencies listed under their headings; without any, the lines that read like requirements
    const block = job.asks.length ? job.asks : useful.filter((l) => askRe.test(l));
    asks = uniq(block.filter((l) => l.length < 320)).slice(0, 8);
  } else {
    asks = uniq(useful.filter((l) => askRe.test(l) && l.length < 320 && !NOISE.test(l))).slice(0, 7);
  }
  let docs = [];
  if (!isJob) {
    docs = uniq(itemsAfterLeadIn(lines, /(submit|provide|include|attach)[^.]{0,60}(following|these)[^.]{0,40}(documents?|information|items)/i));
    if (!docs.length) docs = uniq(lines.filter((l) => DOCS.test(l) && l.length < 240 && !BOILERPLATE.test(l) && !NOT_A_DOCUMENT.test(l))).slice(0, 7);
  }
  let generic = false;
  if (!docs.length) {
    docs = isJob ? T.genericDocsJob : T.genericDocsTender;
    generic = true;
  }
  const keyDates = [];
  if (n.postedDate) keyDates.push({ label: T.datePosted, date: n.postedDate, note: '' });
  if (n.deadline) keyDates.push({ label: T.dateDeadline, date: n.deadline, note: '' });
  return {
    summary,
    whatNrcAsks: asks,
    requiredDocuments: docs,
    requiredDocumentsGeneric: generic,
    keyDates,
    attentionPoints: attentionPoints(n, T, job ? uniq(job.notes.filter((x) => x.length < 260)).slice(0, 2) : []),
    fit: fitText(n, T),
    provider: 'local'
  };
}

const cleanList = (value, max = 8) => (Array.isArray(value) ? value.map((x) => short(typeof x === 'string' ? x : x?.text || '', 320)).filter(Boolean).slice(0, max) : []);

async function aiBrief(n, lang, profile) {
  const context = `Notice type: ${n.kind === 'job' ? 'job vacancy' : 'tender'} (${n.noticeType || 'n/a'})\nTitle: ${n.title}\nReference: ${n.reference || 'n/a'}\nCountry: ${n.country || 'n/a'}\nPublished: ${n.postedDate ? new Date(n.postedDate).toISOString().slice(0, 10) : 'n/a'}\nDeadline: ${n.deadline ? new Date(n.deadline).toISOString().slice(0, 10) : 'not found'}\nContacts: ${(n.contactEmails || []).join(', ') || 'n/a'}\n\nNOTICE TEXT:\n${String(n.description || '').slice(0, 6000)}\n${n.docText ? `\nATTACHED DOCUMENT TEXT:\n${String(n.docText).slice(0, 6000)}` : ''}`;
  const company = `M-ECAL: ${profile.companyName}. ${profile.description}. Services: ${(profile.services || []).join('; ')}. Cities: ${(profile.cities || []).join(', ')}.`;
  const prompt = `${company}\n\n${context}\n\nWrite a brief of this ${n.kind === 'job' ? 'job vacancy' : 'tender'} in ${LANG_NAME[lang] || 'English'}. Use only facts present in the text; never invent requirements, dates or documents.\nJSON: {"summary":"3 to 4 sentences","whatNrcAsks":["..."],"requiredDocuments":["..."],"keyDates":[{"label":"...","date":"YYYY-MM-DD or null","note":"..."}],"attentionPoints":["..."],"fit":"2 sentences on the fit for ${n.kind === 'job' ? 'a logistics professional' : 'M-ECAL'}"}`;
  const { data, provider } = await callAIForJSON(prompt, 'You are a bid analyst helping a Congolese logistics firm read NRC notices. Answer strictly in JSON.');
  const keyDates = Array.isArray(data.keyDates)
    ? data.keyDates
        .map((k) => ({ label: short(k?.label, 80), date: k?.date && !Number.isNaN(new Date(k.date).getTime()) ? new Date(k.date) : undefined, note: short(k?.note, 200) }))
        .filter((k) => k.label)
        .slice(0, 6)
    : [];
  const docs = cleanList(data.requiredDocuments);
  return {
    summary: short(data.summary, 900),
    whatNrcAsks: cleanList(data.whatNrcAsks),
    requiredDocuments: docs,
    requiredDocumentsGeneric: docs.length === 0,
    keyDates,
    attentionPoints: cleanList(data.attentionPoints, 6),
    fit: short(data.fit, 500),
    provider
  };
}

export async function generateBrief(n, { lang = 'fr' } = {}) {
  const language = TEXTS[lang] ? lang : 'fr';
  const profile = await loadProfile();
  let brief = null;
  if (hasAiProviders()) {
    try {
      brief = await aiBrief(n, language, profile);
      if (!brief.summary) brief = null;
    } catch (e) {
      recordAiUsage('keywords');
      logger.info(`NRC brief: IA indisponible (${String(e.message).slice(0, 100)}), analyse locale`);
    }
  }
  if (!brief) brief = localBrief(n, language);
  if (!brief.requiredDocuments.length) {
    const T = TEXTS[language];
    brief.requiredDocuments = n.kind === 'job' ? T.genericDocsJob : T.genericDocsTender;
    brief.requiredDocumentsGeneric = true;
  }
  if (!brief.keyDates.length) {
    const T = TEXTS[language];
    if (n.postedDate) brief.keyDates.push({ label: T.datePosted, date: n.postedDate, note: '' });
    if (n.deadline) brief.keyDates.push({ label: T.dateDeadline, date: n.deadline, note: '' });
  }
  return { ...brief, language, generatedAt: new Date() };
}

// ------------------------------------------------------------------ draft

const KEYWORD_FR = {
  logistics: 'logistique',
  'supply chain': 'chaîne d’approvisionnement',
  warehouse: 'entreposage',
  inventory: 'inventaire',
  transport: 'transport',
  training: 'formation',
  'market study': 'étude de marché',
  consultancy: 'consultance',
  procurement: 'approvisionnement'
};

const TYPE_LABEL = {
  en: { EoI: 'Expression of Interest', RFP: 'proposal', RFQ: 'quotation', ITB: 'bid', Call: 'application', Consultancy: 'proposal', Tender: 'offer' },
  fr: { EoI: 'manifestation d’intérêt', RFP: 'proposition', RFQ: 'cotation', ITB: 'offre', Call: 'candidature', Consultancy: 'proposition', Tender: 'offre' }
};

function pickServices(profile, n) {
  const services = (profile.services || []).filter(Boolean);
  const blob = `${n.title} ${n.description}`.toLowerCase();
  const scored = services
    .map((s) => ({ s, hits: s.toLowerCase().split(/\W+/).filter((w) => w.length > 4 && blob.includes(w)).length }))
    .sort((a, b) => b.hits - a.hits);
  return scored.slice(0, 3).map((x) => x.s);
}

function localDraft(n, { lang, tone, profile, user, brief }) {
  const fr = lang === 'fr';
  const formal = tone !== 'semi-formel';
  const company = profile.companyName || '[company name]';
  const years = String(profile.yearsExperience || '').trim();
  const cities = (profile.cities || []).slice(0, 5).join(', ');
  const contact = [profile.email, profile.phone && profile.phone.replace(/\D/g, '').length > 4 ? profile.phone : ''].filter(Boolean).join(' | ');
  const posted = fmtDate(n.postedDate, lang);

  if (n.kind === 'job') {
    const jp = user?.jobAssistantProfile || {};
    const name = user?.name || jp.fullName || (fr ? '[votre nom]' : '[your name]');
    const summaryBits = [jp.experience, jp.skills].filter(Boolean).map((x) => short(x, 260));
    const body = fr
      ? `${formal ? 'Madame, Monsieur,' : 'Bonjour,'}\n\nJe vous écris pour poser ma candidature au poste de ${n.title}${n.location ? ` (${n.location})` : ''}${n.reference ? `, référence ${n.reference}` : ''}.\n\n${summaryBits.length ? summaryBits.join('\n') : '[Résumez ici votre expérience logistique et vos compétences clés en 3 ou 4 lignes.]'}\n\n${jp.education ? `Formation : ${short(jp.education, 200)}\n\n` : ''}Mon CV est joint à ce message. Je reste disponible pour un entretien.\n\n${formal ? 'Cordialement' : 'Bien à vous'},\n${name}\n${[jp.email || user?.email, jp.phone || user?.phone].filter(Boolean).join(' | ')}`
      : `${formal ? 'Dear NRC Recruitment Team,' : 'Hello,'}\n\nI am writing to apply for the position of ${n.title}${n.location ? ` (${n.location})` : ''}${n.reference ? `, reference ${n.reference}` : ''}.\n\n${summaryBits.length ? summaryBits.join('\n') : '[Summarise your logistics experience and key skills in 3 or 4 lines.]'}\n\n${jp.education ? `Education: ${short(jp.education, 200)}\n\n` : ''}My CV is attached. I remain available for an interview.\n\n${formal ? 'Kind regards' : 'Best regards'},\n${name}\n${[jp.email || user?.email, jp.phone || user?.phone].filter(Boolean).join(' | ')}`;
    return { to: '', subject: fr ? `Candidature : ${n.title}${n.reference ? ` (${n.reference})` : ''}` : `Application: ${n.title}${n.reference ? ` (${n.reference})` : ''}`, body, provider: 'local' };
  }

  const typeLabel = (TYPE_LABEL[lang] || TYPE_LABEL.en)[n.noticeType] || (TYPE_LABEL[lang] || TYPE_LABEL.en).Tender;
  const services = pickServices(profile, n);
  // Only documents really found in the notice go into the message, and only short ones
  const docs = brief && !brief.requiredDocumentsGeneric ? (brief.requiredDocuments || []).filter((d) => d.length <= 140).slice(0, 5) : [];
  const ref = n.reference ? (fr ? ` (réf. ${n.reference})` : ` (ref. ${n.reference})`) : '';
  // The profile description is written in French: it is only reused in a French message
  const description = fr && profile.description ? ` ${short(profile.description, 320)}` : '';
  const about = fr
    ? `${company} est une firme basée en RDC.${description}${years ? ` Forte de ${years} ans d’expérience, nous` : description ? ' Nous' : ' Elle'}${description || years ? ' intervenons' : ' accompagne les organisations'}${cities ? ` à ${cities}` : ''}${services.length ? `, notamment : ${services.join(' ; ')}` : ''}.`
    : `${company} is a firm based in the DR Congo.${years ? ` With ${years} years of experience, it` : ' It'} supports organisations${cities ? ` in ${cities}` : ''}${services.length ? `, notably: ${services.join('; ')}` : ''}.`;
  const fitLine =
    n.matchedKeywords?.length
      ? fr
        ? `Nos services dans les domaines suivants correspondent à cette demande : ${n.matchedKeywords.slice(0, 4).map((k) => KEYWORD_FR[k] || k).join(', ')}.`
        : `Our services in the following areas match this request: ${n.matchedKeywords.slice(0, 4).join(', ')}.`
      : '';
  const refs = profile.projectReferences ? short(profile.projectReferences, 320) : fr ? '[Ajoutez ici 1 ou 2 références de missions similaires.]' : '[Add 1 or 2 references from similar assignments.]';
  const docsLine = docs.length
    ? (fr ? 'Documents joints ou à joindre :\n' : 'Documents attached or to attach:\n') + docs.map((d) => `- ${d}`).join('\n')
    : fr
      ? 'Nous joignons les documents demandés dans l’avis.'
      : 'We attach the documents requested in the notice.';
  const body = fr
    ? `${formal ? 'Madame, Monsieur,' : 'Bonjour,'}\n\nNous vous écrivons pour vous soumettre notre ${typeLabel} concernant « ${n.title} »${ref}${posted ? `, publiée le ${posted}` : ''}.\n\n${about}\n\n${fitLine ? `${fitLine}\n\n` : ''}${refs}\n\n${docsLine}\n\nPour toute précision${contact ? `, vous pouvez nous joindre au ${contact}` : ''}.\n\n${formal ? 'Cordialement' : 'Bien cordialement'},\n${profile.director || '[nom du signataire]'}\n${company}`
    : `${formal ? 'Dear NRC Procurement Team,' : 'Hello,'}\n\nWe are writing to submit our ${typeLabel} for "${n.title}"${ref}${posted ? `, published on ${posted}` : ''}.\n\n${about}\n\n${fitLine ? `${fitLine}\n\n` : ''}${refs}\n\n${docsLine}\n\nFor any clarification${contact ? `, you can reach us at ${contact}` : ''}.\n\n${formal ? 'Kind regards' : 'Best regards'},\n${profile.director || '[name of signatory]'}\n${company}`;
  const subject = n.submissionSubject || [n.noticeType && n.noticeType !== 'Tender' ? n.noticeType : '', n.reference, n.reference ? '-' : '', n.title].filter(Boolean).join(' ');
  return { to: (n.contactEmails || [])[0] || '', subject, body, provider: 'local' };
}

async function aiDraft(n, { lang, tone, profile, user, brief }) {
  const isJob = n.kind === 'job';
  const jp = user?.jobAssistantProfile || {};
  const sender = isJob
    ? `Candidate: ${user?.name || jp.fullName || '[name]'}; e-mail ${jp.email || user?.email || ''}; phone ${jp.phone || user?.phone || ''}. Education: ${jp.education || 'n/a'}. Experience: ${jp.experience || 'n/a'}. Skills: ${jp.skills || 'n/a'}. Languages: ${jp.languages || 'n/a'}.`
    : `Company: ${profile.companyName}. Director: ${profile.director}. E-mail: ${profile.email}. Phone: ${profile.phone}. Address: ${profile.address}. Years of experience: ${profile.yearsExperience || 'n/a'}. Description: ${profile.description}. Services: ${(profile.services || []).join('; ')}. Cities: ${(profile.cities || []).join(', ')}. Project references: ${profile.projectReferences || 'n/a'}.`;
  const prompt = `${sender}\n\nNOTICE\nType: ${n.noticeType || n.kind}\nTitle: ${n.title}\nReference: ${n.reference || 'n/a'}\nCountry: ${n.country || 'n/a'}\nDeadline: ${n.deadline ? new Date(n.deadline).toISOString().slice(0, 10) : 'n/a'}\nRequired subject line: ${n.submissionSubject || 'none'}\nSubmission e-mail: ${(n.contactEmails || [])[0] || 'n/a'}\nText:\n${String(n.description || '').slice(0, 4500)}\n${n.docText ? `Attached document:\n${String(n.docText).slice(0, 3500)}\n` : ''}\nBrief documents required: ${(brief?.requiredDocuments || []).join('; ') || 'n/a'}\n\nWrite ${isJob ? 'a cover e-mail for this application' : 'the submission e-mail answering this notice'} in ${LANG_NAME[lang]}, ${tone === 'semi-formel' ? 'warm and professional' : 'formal'} tone, 180 to 280 words. Use ONLY the facts above: never invent clients, figures, certifications or experience; where information is missing write it in [square brackets]. ${n.submissionSubject ? 'Use exactly the required subject line.' : ''}\nJSON: {"subject":"...","body":"..."}`;
  const { data, provider } = await callAIForJSON(prompt, 'You write concise, honest business e-mails for a Congolese logistics firm answering NRC notices. Answer strictly in JSON.');
  const body = String(data.body || '').trim();
  if (!body) throw new Error('brouillon vide');
  return {
    to: isJob ? '' : (n.contactEmails || [])[0] || '',
    subject: n.submissionSubject || short(data.subject, 200),
    body,
    provider
  };
}

export async function generateDraft(n, { lang = 'en', tone = 'formel', user = null } = {}) {
  const language = lang === 'fr' ? 'fr' : 'en';
  const profile = await loadProfile();
  const brief = n.brief?.summary ? n.brief : null;
  let draft = null;
  if (hasAiProviders()) {
    try {
      draft = await aiDraft(n, { lang: language, tone, profile, user, brief });
    } catch (e) {
      recordAiUsage('keywords');
      logger.info(`NRC brouillon: IA indisponible (${String(e.message).slice(0, 100)}), modèle local`);
    }
  }
  if (!draft) draft = localDraft(n, { lang: language, tone, profile, user, brief });
  return { ...draft, language, tone, generatedAt: new Date() };
}
