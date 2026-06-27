import { filterJobListings, extractJobCity } from '../config/jobBusinessRules.js';
import { callAIForJSON } from './aiService.js';
import { buildActionableNoResultsResponse } from './jobNoResultsService.js';
import { searchAllSources } from './jobSearchAggregator.js';
import { getActiveJobSourceLabels } from '../config/jobSources.js';
import {
  buildJobAssistantSystemPrompt,
  buildJobSearchSummaryPrompt
} from '../prompts/jobAssistantPrompt.js';
import { detectMessageLanguage } from '../utils/detectMessageLanguage.js';
import logger from '../utils/logger.js';

const NON_PRECISE = 'Non précisé';

function normalizeUrl(url = '') {
  try {
    const u = new URL(url.trim());
    return u.href.replace(/\/$/, '').toLowerCase();
  } catch {
    return (url || '').trim().toLowerCase();
  }
}

export function validateJobsAgainstRaw(aiJobs = [], rawJobs = []) {
  const allowed = new Set(
    rawJobs.map((j) => normalizeUrl(j.sourceUrl)).filter(Boolean)
  );
  return (aiJobs || []).filter((j) => allowed.has(normalizeUrl(j.sourceUrl)));
}

function formatDeadline(deadline) {
  if (!deadline) return NON_PRECISE;
  const d = new Date(deadline);
  if (Number.isNaN(d.getTime())) return NON_PRECISE;
  return d.toISOString().slice(0, 10);
}

export function formatJobForClient(job) {
  return {
    title: job.title || NON_PRECISE,
    organization: job.organization?.trim() || NON_PRECISE,
    city: extractJobCity(job.description || '', job.location || '') || NON_PRECISE,
    contractType: job.contractType?.trim() || NON_PRECISE,
    deadline: formatDeadline(job.deadline),
    sourceUrl: job.sourceUrl || '',
    platform: job.platform || NON_PRECISE,
    source: job.source || '',
    verified: Boolean(job.sourceUrl)
  };
}

function buildVerifiedJobsFromRaw(rawJobs = []) {
  return rawJobs.map(formatJobForClient);
}

function applyQueryFilter(results, { query, role, allRdc, broadenSearch }) {
  if (allRdc || broadenSearch) {
    if (role) {
      const r = role.toLowerCase();
      return results.filter((j) => {
        const blob = `${j.title} ${j.description} ${j.organization}`.toLowerCase();
        return blob.includes(r);
      });
    }
    return results;
  }

  if (!query) return results;

  const q = query.toLowerCase();
  const stopWords = new Set([
    'cherche',
    'recherche',
    'emploi',
    'offre',
    'poste',
    'rdc',
    'congo',
    'verifie',
    'vérifie',
    'toutes',
    'villes',
    'ville',
    'dans',
    'pour',
    'service',
    'savoir',
    'veux',
    'une',
    'des',
    'les',
    'sur'
  ]);

  return results.filter((j) => {
    const blob = `${j.title} ${j.description} ${j.organization}`.toLowerCase();
    if (role && blob.includes(role.toLowerCase())) return true;
    const tokens = q.split(/\s+/).filter((w) => w.length > 3 && !stopWords.has(w));
    if (!tokens.length) return true;
    return tokens.some((w) => blob.includes(w)) || blob.includes(q);
  });
}

export async function fetchRawJobListings({
  query = '',
  city,
  role,
  allRdc = false,
  broadenSearch = false,
  sources = null
} = {}) {
  const aggregated = await searchAllSources({ query, city, role, allRdc, broadenSearch, sources });
  const merged = aggregated.offers;
  const logisticsFiltered = filterJobListings(merged);
  const results = applyQueryFilter(logisticsFiltered, {
    query,
    role,
    allRdc,
    broadenSearch: broadenSearch || allRdc
  });

  logger.info(
    `[JobAssistant] ${merged.length} raw → ${logisticsFiltered.length} logistique → ${results.length} après filtre`
  );

  return {
    jobs: results,
    sources: aggregated.sources,
    sourceAlerts: aggregated.sourceAlerts,
    failedSources: aggregated.failedSources,
    allSourcesFailed: aggregated.allSourcesFailed,
    sourcesRespondedEmpty: aggregated.sourcesRespondedEmpty,
    rawCount: merged.length,
    logisticsCount: logisticsFiltered.length
  };
}

async function buildSummaryMessage(rawJobs, userNeed, locale = 'fr') {
  const systemPrompt = buildJobAssistantSystemPrompt(undefined, locale);
  const prompt = `${buildJobSearchSummaryPrompt(locale)}

Besoin utilisateur : ${userNeed}

Offres brutes (${rawJobs.length}) :
${JSON.stringify(
  rawJobs.slice(0, 25).map((j) => ({
    title: j.title,
    organization: j.organization,
    sourceUrl: j.sourceUrl
  })),
  null,
  2
)}`;

  try {
    const { data } = await callAIForJSON(prompt, systemPrompt);
    if (data.jobs?.length) {
      const validated = validateJobsAgainstRaw(data.jobs, rawJobs);
      if (validated.length !== data.jobs.length) {
        logger.warn('[JobAssistant] IA a tenté d\'ajouter des offres non sources — ignorées');
      }
    }
    return (
      data.message ||
      (locale === 'en'
        ? `I found ${rawJobs.length} verified offer(s) in DRC. Select a card to generate your CV.`
        : `J'ai trouvé ${rawJobs.length} offre(s) vérifiée(s) en RDC. Sélectionnez une carte pour générer votre CV.`)
    );
  } catch (e) {
    logger.warn(`[JobAssistant] Résumé IA échoué: ${e.message}`);
    return locale === 'en'
      ? `I found ${rawJobs.length} verified offer(s) in DRC. Select a card to generate your CV.`
      : `J'ai trouvé ${rawJobs.length} offre(s) vérifiée(s) en RDC. Sélectionnez une carte pour générer votre CV.`;
  }
}

export async function searchJobsWithAI({
  query,
  city,
  role,
  allRdc = false,
  broadenSearch = false,
  userNeed,
  sources = null,
  locale = 'fr'
} = {}) {
  const need = userNeed || [role, allRdc ? 'toutes villes RDC' : city, query].filter(Boolean).join(' — ') || 'emplois logistique RDC';

  let fetchResult = await fetchRawJobListings({
    query,
    city,
    role,
    allRdc,
    broadenSearch,
    sources
  });
  let rawJobs = fetchResult.jobs;
  let broadened = false;

  if (rawJobs.length === 0 && fetchResult.logisticsCount > 0) {
    fetchResult = await fetchRawJobListings({
      query,
      city,
      role,
      allRdc: true,
      broadenSearch: true,
      sources
    });
    rawJobs = fetchResult.jobs;
    broadened = rawJobs.length > 0;
  }

  if (rawJobs.length === 0) {
    const actionable = await buildActionableNoResultsResponse({
      userNeed: need,
      city,
      role,
      allRdc,
      sources: fetchResult.sources,
      failedSources: fetchResult.failedSources,
      allSourcesFailed: fetchResult.allSourcesFailed,
      sourcesRespondedEmpty: fetchResult.sourcesRespondedEmpty,
      rawCount: fetchResult.rawCount,
      filteredCount: 0,
      broadened
    });

    return {
      message: actionable.message,
      jobs: [],
      suggestions: actionable.suggestions,
      manualLinks: actionable.manualLinks,
      diagnosis: actionable.diagnosis,
      provider: 'actionable-guidance',
      rawCount: fetchResult.rawCount,
      noResults: true,
      sources: fetchResult.sources,
      sourceAlerts: fetchResult.sourceAlerts,
      failedSources: fetchResult.failedSources,
      allSourcesFailed: fetchResult.allSourcesFailed
    };
  }

  const verifiedJobs = buildVerifiedJobsFromRaw(rawJobs);
  let message = await buildSummaryMessage(rawJobs, need, locale);

  if (broadened) {
    message = `Critères élargis automatiquement (toutes villes RDC). ${message}`;
  }

  return {
    message,
    jobs: verifiedJobs,
    provider: 'sources-verified',
    rawCount: fetchResult.rawCount,
    noResults: false,
    sources: fetchResult.sources,
    sourceAlerts: fetchResult.sourceAlerts,
    failedSources: fetchResult.failedSources,
    suggestions: [],
    manualLinks: []
  };
}

export { getActiveJobSourceLabels };
