import NrcNotice from '../models/NrcNotice.js';
import SystemSetting from '../models/SystemSetting.js';
import logger from '../utils/logger.js';
import { classifyMecalCategory, findKeywordMatches, hasAiProviders, SERVICES_INCLUS } from '../config/businessRules.js';
import { callAIForJSON, recordAiUsage } from './aiService.js';
import * as nrc from '../scrapers/nrc.js';
import { countryCodeFrom, countryNameFrom, inferCountryCode, isDrcNotice, isRealCountryCode } from './nrcCountries.js';

const SYNC_KEY = 'nrc_sync';
const HIGH_SCORE = 60;
const MEDIUM_SCORE = 35;
const REMOVED_AFTER_MS = 3 * 24 * 60 * 60 * 1000;
const MAX_TENDER_DETAILS = Math.max(1, Number(process.env.NRC_MAX_TENDER_DETAILS || 20));
const MAX_JOB_DETAILS = Math.max(1, Number(process.env.NRC_MAX_JOB_DETAILS || 80));
const MAX_AI_SCORES = Math.max(0, Number(process.env.NRC_MAX_AI_SCORES || 25));

let inFlight = null;

export function isNrcSyncRunning() {
  return Boolean(inFlight);
}

// ------------------------------------------------------------------ sync state

async function patchSyncState(patch) {
  const $set = {};
  for (const [key, value] of Object.entries(patch)) $set[`value.${key}`] = value;
  await SystemSetting.findOneAndUpdate({ key: SYNC_KEY }, { $set }, { upsert: true });
}

export async function getSyncState() {
  const doc = await SystemSetting.findOne({ key: SYNC_KEY }).lean();
  return { ...(doc?.value || {}), running: isNrcSyncRunning() };
}

// ------------------------------------------------------------------ scoring

const labelOf = (score) => (score >= HIGH_SCORE ? 'high' : score >= MEDIUM_SCORE ? 'medium' : 'low');

const TENDER_SIGNALS = [
  ['logistics', /\blogistic/i, 14],
  ['supply chain', /supply[- ]chain/i, 14],
  ['warehouse', /warehous|\bstorage\b|entrep[oô]t/i, 12],
  ['inventory', /\binventor|stock (management|control|taking)|asset (verification|tagging|management)/i, 12],
  ['transport', /\btransport|\bfleet\b|\bvehicles?\b|\bfuel\b|freight|haulage|trucking|last[- ]mile|distribution/i, 10],
  ['training', /\btraining\b|capacity[- ]building|formation|driver training|defensive driving/i, 12],
  ['market study', /market (study|assessment|analysis|survey)|feasibility study|etude de march/i, 12],
  ['consultancy', /consultanc|consultant|advisory|technical assistance|\bassessment\b|\bevaluation\b|\baudit\b/i, 10],
  ['procurement', /procurement (support|capacity|system)|cold chain|customs|clearing/i, 8]
];

// Buying goods or building things is not what M-ECAL sells, unless logistics is also involved
const GOODS_ONLY = /\b(supply|delivery|purchase|procurement) of\b|\bsupply and (delivery|installation)\b|\bconstruction\b|\brehabilitation (works|of)\b|\bcivil works\b|\bgenerators?\b|\bfuel\b|\bsolar\b|\bfurniture\b|\blaptops?\b|\bit equipment\b|\bcatering\b|\baccommodation\b|\bhall\b/i;

const JOB_LOGISTICS_TITLE = /\blogistic|supply[- ]chain|procurement|warehouse|\bfleet\b|\bstock|transport|distribution|store ?keeper|\bsupply\b|asset management/i;
const JOB_OTHER_DOMAIN = /\b(finance|financial|wash|shelter|legal|icla|protection|education|meal\b|human resources|\bhr\b|security|\bit\b|gender|youth|communication|advocacy|grants?|donor|programme?|health|livelihood|food security|cash|camp management|safeguarding)\b/i;
// What makes a notice a logistics notice (the only kind shown): supply chain, transport and fleet, storage, stock and assets
const LOGISTICS_TITLE = /\blogistic|supply[- ]chain|warehous|\bstorage\b|entrep[oô]t|\bstock\b|inventor|\btransport|freight|haulage|trucking|\bfleet\b|\bvehicles?\b|\bfuel\b|distribution|customs|clearing|\bcourier\b|last[- ]mile|cold chain|asset (management|verification|tagging)|\bshipping\b|\bcargo\b/i;
const LOGISTICS_TEXT_SIGNALS = [
  /\blogistic/i,
  /supply[- ]chain/i,
  /warehous|\bstorage\b|entrep[oô]t/i,
  /\btransport|freight|haulage|trucking|\bfleet\b|\bvehicles?\b/i,
  /\bfuel\b/i,
  /distribution/i,
  /\binventor|\bstock\b|asset (management|verification|tagging)/i,
  /customs|clearing|import(ation)?\b/i,
  /cold chain/i
];

/** True when the notice is about logistics. Jobs: the NRC category or the title. Tenders: the title, or several logistics themes in the text. */
export function classifyLogistics(n) {
  const title = String(n.title || '');
  if (n.kind === 'job') {
    return JOB_LOGISTICS_TITLE.test(title) || /logistic|supply|procurement/i.test(n.jobInfo?.category || '');
  }
  if (LOGISTICS_TITLE.test(title)) return true;
  const text = `${n.description || ''}\n${n.docText || ''}`;
  return LOGISTICS_TEXT_SIGNALS.filter((re) => re.test(text)).length >= 4;
}

const JOB_DESCRIPTION_SIGNALS = /\blogistic|supply chain|procurement|warehouse|\bfleet\b|inventory|stock|transport|distribution|vehicle|customs/gi;

const clamp = (n) => Math.max(0, Math.min(100, Math.round(n)));

/** Keyword score, 0 to 100, with the factors that explain it (translated by the interface). */
export function scoreNoticeByKeywords(n) {
  const factors = [];
  const title = String(n.title || '');
  const text = `${title}\n${n.description || ''}\n${n.docText || ''}`;
  const keywords = [];

  if (n.kind === 'job') {
    let score = 8;
    const strongTitle = JOB_LOGISTICS_TITLE.test(title);
    const logisticsCategory = /logistic|supply|procurement/i.test(n.jobInfo?.category || '');
    if (!strongTitle && logisticsCategory) {
      score = 52;
      factors.push('job_logistics_category');
    }
    if (strongTitle) {
      score = 62;
      factors.push('job_logistics_title');
      const m = title.match(JOB_LOGISTICS_TITLE);
      if (m) keywords.push(m[0].toLowerCase());
    } else if (!logisticsCategory && JOB_OTHER_DOMAIN.test(title)) {
      score = 10;
      factors.push('job_other_domain');
    }
    const hits = (text.match(JOB_DESCRIPTION_SIGNALS) || []).map((h) => h.toLowerCase());
    if (hits.length) {
      score += Math.min(strongTitle ? 20 : 22, hits.length * 3);
      keywords.push(...new Set(hits));
      factors.push('job_logistics_text');
    }
    if (strongTitle && /\b(head|director|manager|coordinator|lead)\b/i.test(title)) score += 6;
    if (n.isDrc) {
      score += 10;
      factors.push('drc');
    } else {
      score *= 0.9;
      factors.push('abroad');
    }
    return { score: clamp(score), factors, keywords: [...new Set(keywords)].slice(0, 8) };
  }

  let raw = 0;
  let signalCount = 0;
  for (const [label, pattern, weight] of TENDER_SIGNALS) {
    if (pattern.test(text)) {
      const inTitle = pattern.test(title);
      raw += inTitle ? weight * 1.5 : weight;
      signalCount += 1;
      keywords.push(label);
    }
  }
  if (signalCount) factors.push('logistics_signals');
  const category = classifyMecalCategory(text);
  if (category) {
    raw += 15;
    factors.push('mecal_category');
  }
  const serviceHits = findKeywordMatches(text, SERVICES_INCLUS);
  if (serviceHits.length) {
    raw += Math.min(12, serviceHits.length * 4);
    keywords.push(...serviceHits.slice(0, 3));
  }
  if (GOODS_ONLY.test(title) && signalCount < 2) {
    raw = Math.max(0, raw - 20);
    factors.push('goods_only');
  }
  if (n.isDrc) {
    raw += 12;
    factors.push('drc');
  } else {
    raw *= 0.8;
    factors.push('abroad');
  }
  if (!signalCount && !category) factors.push('weak_signals');
  return { score: clamp(raw), factors, keywords: [...new Set(keywords)].slice(0, 8) };
}

async function scoreWithAi(n, keyword) {
  const isJob = n.kind === 'job';
  const prompt = `${isJob ? 'Poste NRC' : 'Appel d’offres NRC'}\nTitre: ${n.title}\nPays: ${n.country || 'inconnu'}\nType: ${n.noticeType || ''}\nDescription: ${String(n.description || '').slice(0, 2500)}\n${n.docText ? `Document joint: ${String(n.docText).slice(0, 1500)}\n` : ''}\n${
    isJob
      ? 'Évalue si ce poste convient à un professionnel logistique / supply chain (0 à 100).'
      : 'Évalue si cet appel d’offres convient à M-ECAL, firme congolaise de services logistiques (formations logistiques, formation des chauffeurs, inventaires, études de marché, consultance supply chain, entrepôts) : 0 à 100. Un achat de biens ou de travaux sans volet logistique vaut peu.'
  }\nJSON: {"score":0-100,"justification":"une phrase en français"}`;
  const { data, provider } = await callAIForJSON(
    prompt,
    'Tu qualifies des avis d’ONG humanitaires pour une firme de logistique en RDC. Réponds strictement en JSON.'
  );
  const ai = clamp(Number(data.score));
  return {
    score: clamp(ai * 0.7 + keyword.score * 0.3),
    reason: String(data.justification || '').slice(0, 400),
    provider
  };
}

export async function scoreNotice(n, { useAi = false } = {}) {
  const isLogistics = classifyLogistics(n);
  const keyword = scoreNoticeByKeywords(n);
  let result = { score: keyword.score, reason: '', provider: 'keywords' };
  if (useAi && hasAiProviders()) {
    try {
      result = await scoreWithAi(n, keyword);
    } catch (e) {
      recordAiUsage('keywords');
      logger.info(`NRC: scoring IA indisponible (${String(e.message).slice(0, 100)}), score mots-clés`);
    }
  }
  return {
    isLogistics,
    fitsMecal: isLogistics && result.score >= HIGH_SCORE,
    classifiedAt: new Date(),
    score: result.score,
    scoreLabel: labelOf(result.score),
    scoreReason: result.reason,
    scoreProvider: result.provider,
    scoreFactors: keyword.factors,
    matchedKeywords: keyword.keywords,
    scoredAt: new Date()
  };
}

// ------------------------------------------------------------------ upserts

function locationFields({ country = '', countryCode = '', location = '', title = '', text = '' }) {
  let code = countryCode || countryCodeFrom(country) || countryCodeFrom(location);
  const worldwide = Boolean(code) && !isRealCountryCode(code);
  if (worldwide) code = '';
  const name = countryNameFrom(code, worldwide ? 'International' : country);
  return {
    country: name || country,
    countryCode: code,
    isDrc: isDrcNotice({ countryCode: code, country: name || country, location, title, text })
  };
}

async function upsertTenderBasic(item, now) {
  const externalId = `tender:${item.slug}`;
  const found = await NrcNotice.findOne({ externalId }).select('_id detailFetchedAt archivedReason countryCode');
  const loc = item.country ? locationFields({ country: item.country, title: item.title }) : null;
  if (!found) {
    await NrcNotice.create({
      kind: 'tender',
      externalId,
      title: item.title,
      url: item.url,
      applyUrl: item.url,
      noticeType: nrc.detectTenderType(item.title),
      postedDate: item.postedDate || undefined,
      firstSeenAt: now,
      lastSeenAt: now,
      ...(loc || {})
    });
    return true;
  }
  const $set = { lastSeenAt: now, title: item.title };
  if (found.archivedReason === 'removed') Object.assign($set, { isArchived: false, archivedReason: '' });
  if (loc && !found.countryCode) Object.assign($set, loc);
  await NrcNotice.updateOne({ _id: found._id }, { $set });
  return false;
}

async function enrichTender(doc, { skipAttachments }) {
  const detail = await nrc.fetchTenderDetail(doc.url);
  let docText = '';
  if (!skipAttachments && detail.documents[0]) docText = await nrc.fetchAttachmentText(detail.documents[0]);
  let deadline = detail.deadline;
  if (!deadline && docText) deadline = nrc.extractTenderDeadline(docText, detail.postedDate);
  const code = doc.countryCode || inferCountryCode({ title: detail.title || doc.title, reference: detail.reference, text: detail.description });
  const loc = locationFields({ country: doc.country, countryCode: code, title: detail.title || doc.title, text: detail.description });
  const $set = {
    title: detail.title || doc.title,
    noticeType: detail.noticeType,
    description: detail.description,
    docText,
    contactEmails: detail.contactEmails,
    submissionSubject: detail.submissionSubject,
    reference: detail.reference,
    documents: detail.documents,
    detailFetchedAt: new Date(),
    scoredAt: null,
    ...loc
  };
  if (detail.postedDate) $set.postedDate = detail.postedDate;
  if (deadline) Object.assign($set, { deadline, sortDeadline: deadline.getTime() });
  await NrcNotice.updateOne({ _id: doc._id }, { $set });
}

async function upsertJobBasic(job, now) {
  const externalId = `job:${job.id}`;
  const found = await NrcNotice.findOne({ externalId }).select('_id archivedReason');
  const loc = locationFields({ countryCode: job.countryCode, location: job.location, title: job.title });
  const url = nrc.jobPublicUrl(job.id);
  if (!found) {
    await NrcNotice.create({
      kind: 'job',
      externalId,
      title: job.title,
      url,
      applyUrl: url,
      location: job.location,
      postedDate: job.postedDate || undefined,
      firstSeenAt: now,
      lastSeenAt: now,
      jobInfo: { workplace: job.workplace, schedule: job.schedule },
      ...loc
    });
    return true;
  }
  const $set = { lastSeenAt: now, title: job.title, location: job.location, ...loc };
  if (found.archivedReason === 'removed') Object.assign($set, { isArchived: false, archivedReason: '' });
  await NrcNotice.updateOne({ _id: found._id }, { $set });
  return false;
}

async function enrichJob(doc) {
  const id = doc.externalId.replace(/^job:/, '');
  const detail = await nrc.fetchJobDetail(id);
  if (!detail) {
    await NrcNotice.updateOne({ _id: doc._id }, { $set: { detailFetchedAt: new Date() } });
    return;
  }
  const loc = locationFields({ countryCode: detail.countryCode || doc.countryCode, location: detail.location || doc.location, title: detail.title });
  const $set = {
    title: detail.title || doc.title,
    description: detail.description,
    reference: detail.reference,
    contactEmails: detail.contactEmails,
    contactName: detail.contactName,
    location: detail.location || doc.location,
    noticeType: detail.jobInfo.category,
    jobInfo: detail.jobInfo,
    detailFetchedAt: new Date(),
    scoredAt: null,
    ...loc
  };
  if (detail.postedDate) $set.postedDate = detail.postedDate;
  if (detail.deadline) Object.assign($set, { deadline: detail.deadline, sortDeadline: detail.deadline.getTime() });
  await NrcNotice.updateOne({ _id: doc._id }, { $set });
}

// ------------------------------------------------------------------ lifecycle

async function refreshLifecycle({ tendersSeen, jobsSeen }, runStart) {
  const now = Date.now();
  // Past deadline: closed. A deadline that moved forward reopens the notice.
  await NrcNotice.updateMany({ isArchived: false, deadline: { $lt: new Date(now - 24 * 60 * 60 * 1000) } }, { $set: { isArchived: true, archivedReason: 'expired' } });
  await NrcNotice.updateMany({ isArchived: true, archivedReason: 'expired', deadline: { $gte: new Date(now) } }, { $set: { isArchived: false, archivedReason: '' } });
  // No longer on the NRC site: closed as well (only when the list of its kind was read successfully)
  const gone = new Date(now - REMOVED_AFTER_MS);
  if (jobsSeen > 0) {
    await NrcNotice.updateMany({ kind: 'job', isArchived: false, lastSeenAt: { $lt: runStart } }, { $set: { isArchived: true, archivedReason: 'removed' } });
  }
  if (tendersSeen > 0) {
    await NrcNotice.updateMany({ kind: 'tender', isArchived: false, lastSeenAt: { $lt: gone } }, { $set: { isArchived: true, archivedReason: 'removed' } });
  }
  // "New" only lasts a week
  await NrcNotice.updateMany({ isNew: true, firstSeenAt: { $lt: new Date(now - 7 * 24 * 60 * 60 * 1000) } }, { $set: { isNew: false } });
}

async function scorePending(limitAi = MAX_AI_SCORES) {
  const pending = await NrcNotice.find({ scoredAt: null }).select('kind title country isDrc description docText noticeType jobInfo').lean();
  let ai = 0;
  for (const n of pending) {
    // The AI only looks at logistics notices: the others are never shown
    const useAi = ai < limitAi && Boolean(n.description) && classifyLogistics(n);
    const result = await scoreNotice(n, { useAi });
    if (result.scoreProvider !== 'keywords') ai += 1;
    await NrcNotice.updateOne({ _id: n._id }, { $set: result });
  }
  return pending.length;
}

// ------------------------------------------------------------------ re-classification of what is already stored

/**
 * Notices saved before a rule existed (logistics scope, readable job numbers) are brought up to date at once, from
 * what is stored: no request to NRC. Runs at start-up so the page is right without waiting for the next collection.
 */
export async function reclassifyStored() {
  await NrcNotice.updateMany({ classifiedAt: null }, { $set: { scoredAt: null } });
  // A vacancy is known by the short number of its address (21648), not by the long internal identifier
  await NrcNotice.updateMany({ kind: 'job', reference: /^\d{12,}$/ }, [{ $set: { reference: { $substrCP: ['$externalId', 4, 30] } } }]);
  const done = await scorePending(0);
  if (done) logger.info(`NRC: ${done} avis déjà enregistrés reclassés`);
  return done;
}

// ------------------------------------------------------------------ sync

/**
 * One full pass: read both lists, save what is new, fetch the detail of notices not yet detailed (with the
 * pause NRC asks for), then score. Safe to call while another pass runs: it answers "already running".
 */
export async function syncNrc({ trigger = 'cron', maxTenderDetails = MAX_TENDER_DETAILS, maxJobDetails = MAX_JOB_DETAILS, skipAttachments = process.env.NRC_SKIP_ATTACHMENTS === 'true' } = {}) {
  if (inFlight) return { status: 'already_running' };
  inFlight = (async () => {
    const started = Date.now();
    const errors = [];
    const stats = { newTenders: 0, newJobs: 0, tendersSeen: 0, jobsSeen: 0, detailed: 0, scored: 0 };
    await patchSyncState({ startedAt: new Date(started), trigger, lastError: '' });
    // Notices saved before the logistics rule existed are classified again
    await NrcNotice.updateMany({ classifiedAt: null }, { $set: { scoredAt: null } });
    // A vacancy is known by the short number of its address (21648), not by the long internal identifier
    await NrcNotice.updateMany({ kind: 'job', reference: /^\d{12,}$/ }, [{ $set: { reference: { $substrCP: ['$externalId', 4, 30] } } }]);
    try {
      const now = new Date();
      try {
        const list = await nrc.fetchTenderList();
        stats.tendersSeen = list.length;
        for (const item of list) if (await upsertTenderBasic(item, now)) stats.newTenders += 1;
      } catch (e) {
        errors.push(`tenders: ${e.message}`);
        logger.warn(`NRC: liste des appels d'offres illisible: ${e.message}`);
      }
      try {
        const jobs = await nrc.fetchJobList();
        stats.jobsSeen = jobs.length;
        for (const job of jobs) if (await upsertJobBasic(job, now)) stats.newJobs += 1;
      } catch (e) {
        errors.push(`jobs: ${e.message}`);
        logger.warn(`NRC: liste des emplois illisible: ${e.message}`);
      }

      // Scores from the titles are available right away; details refine them afterwards
      await scorePending(0);

      const jobsToDetail = await NrcNotice.find({ kind: 'job', detailFetchedAt: null, isArchived: false }).sort({ postedDate: -1 }).limit(maxJobDetails);
      for (const doc of jobsToDetail) {
        try {
          await enrichJob(doc);
          stats.detailed += 1;
        } catch (e) {
          errors.push(`job ${doc.externalId}: ${e.message}`);
        }
      }
      const tendersToDetail = await NrcNotice.find({ kind: 'tender', detailFetchedAt: null, isArchived: false }).sort({ postedDate: -1 }).limit(maxTenderDetails);
      for (const doc of tendersToDetail) {
        try {
          await enrichTender(doc, { skipAttachments });
          stats.detailed += 1;
        } catch (e) {
          errors.push(`tender ${doc.externalId}: ${e.message}`);
        }
      }

      await refreshLifecycle(stats, now);
      stats.scored = await scorePending();
    } catch (e) {
      errors.push(e.message);
      logger.error(`NRC sync: ${e.stack || e.message}`);
    }
    const backlog = await NrcNotice.countDocuments({ detailFetchedAt: null, isArchived: false });
    const summary = {
      running: false,
      lastRunAt: new Date(),
      lastDurationMs: Date.now() - started,
      lastStats: stats,
      detailBacklog: backlog,
      lastError: errors.slice(0, 5).join(' | ').slice(0, 800),
      lastStatus: errors.length && !stats.tendersSeen && !stats.jobsSeen ? 'error' : 'success'
    };
    await patchSyncState(summary);
    logger.info(`NRC sync (${trigger}): ${JSON.stringify(stats)} backlog=${backlog} erreurs=${errors.length}`);
    return { status: 'done', ...summary };
  })().finally(() => {
    inFlight = null;
  });
  return inFlight;
}

export async function syncIsStale(maxAgeMs) {
  const state = await getSyncState();
  return !state.lastRunAt || Date.now() - new Date(state.lastRunAt).getTime() > maxAgeMs;
}
