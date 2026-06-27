/**
 * Agrégateur résilient multi-sources pour l'Assistant Emploi.
 * Chaque source est interrogée indépendamment (Promise.allSettled + timeout individuel).
 */
import { searchReliefWebJobs } from '../scrapers/jobSources/reliefWebJobs.js';
import { searchMediaCongo } from '../scrapers/jobSources/mediacongo.js';
import { searchUnjobnet } from '../scrapers/jobSources/unjobnet.js';
import { searchCoordinationSud } from '../scrapers/jobSources/coordinationSud.js';
import { searchImpactPool } from '../scrapers/jobSources/impactPool.js';
import { getJobSourceLabel, JOB_SOURCE_REGISTRY } from '../config/jobSources.js';
import { getCircuitBreakerStatus } from '../scrapers/jobSources/jobSourceUtils.js';
import logger from '../utils/logger.js';

const SOURCE_TIMEOUT_MS = Number(process.env.JOB_SOURCE_TIMEOUT_MS) || 18000;

const SOURCE_SEARCHERS = {
  reliefweb: {
    search: async ({ city, role, query, allRdc, broadenSearch }) => {
      const cityFilter = allRdc || broadenSearch ? undefined : city;
      return searchReliefWebJobs({ city: cityFilter });
    }
  },
  mediacongo: {
    search: async () => searchMediaCongo()
  },
  unjobnet: {
    search: async () => searchUnjobnet()
  },
  coordination_sud: {
    search: async ({ query }) => searchCoordinationSud({ query })
  },
  impact_pool: {
    search: async ({ query }) => searchImpactPool({ query })
  }
};

function buildSourceMessage(name, result) {
  const label = getJobSourceLabel(name);
  if (result.status === 'disabled') {
    if (result.error === 'circuit_open') return result.message;
    if (result.error === 'not_configured') {
      return `${label} désactivé — configurez RELIEFWEB_APPNAME dans backend/.env`;
    }
    return `${label} temporairement désactivé`;
  }
  if (result.status === 'error') {
    if (result.error === '403') {
      return `${label} indisponible (appname non approuvé — configurez RELIEFWEB_APPNAME)`;
    }
    if (result.error === 'robots_txt_disallow') {
      return result.message || `${label} indisponible (robots.txt interdit le scraping)`;
    }
    if (result.error === 'timeout') {
      return `${label} n'a pas répondu à temps (${SOURCE_TIMEOUT_MS / 1000}s)`;
    }
    return `${label} indisponible (${result.error})`;
  }
  return null;
}

async function fetchSourceWithTimeout(sourceName, searchFn, searchParams) {
  const circuit = getCircuitBreakerStatus(sourceName);
  if (circuit.disabled) {
    return {
      items: [],
      status: 'disabled',
      error: 'circuit_open',
      message: circuit.message
    };
  }

  try {
    return await Promise.race([
      searchFn(searchParams),
      new Promise((_, reject) =>
        setTimeout(
          () => reject(Object.assign(new Error('timeout'), { code: 'timeout' })),
          SOURCE_TIMEOUT_MS
        )
      )
    ]);
  } catch (e) {
    if (e.code === 'timeout' || e.message === 'timeout') {
      logger.warn(`[JobAssistant] ${sourceName} timeout après ${SOURCE_TIMEOUT_MS}ms`);
      return {
        items: [],
        status: 'error',
        error: 'timeout',
        message: `${getJobSourceLabel(sourceName)} n'a pas répondu à temps`
      };
    }
    return {
      items: [],
      status: 'error',
      error: e.response?.status || e.code || 'unknown',
      message: e.message
    };
  }
}

function buildSourceReport(sourceResults) {
  const report = {};
  for (const [name, result] of Object.entries(sourceResults)) {
    report[name] = {
      status: result.status,
      count: result.items?.length || 0,
      error: result.error || null,
      message: buildSourceMessage(name, result),
      fromCache: Boolean(result.fromCache)
    };
  }
  return report;
}

export function buildSourceAlertsFromReport(sources = {}) {
  const alerts = [];
  for (const [name, info] of Object.entries(sources)) {
    if (info.message && (info.status === 'error' || info.status === 'disabled')) {
      alerts.push(info.message);
    }
  }
  const timedOut = Object.values(sources).filter((s) => s.error === 'timeout');
  if (timedOut.length === 1) {
    alerts.push('1 source n\'a pas répondu à temps — résultats partiels affichés.');
  } else if (timedOut.length > 1) {
    alerts.push(`${timedOut.length} sources n'ont pas répondu à temps.`);
  }
  return [...new Set(alerts)].filter(Boolean);
}

export function getRegisteredJobSources() {
  return JOB_SOURCE_REGISTRY.map((s) => s.name);
}

export async function searchAllSources(searchParams = {}) {
  const sourceFilter = Array.isArray(searchParams.sources)
    ? searchParams.sources.filter(Boolean)
    : null;

  const sources = JOB_SOURCE_REGISTRY.map((meta) => ({
    name: meta.name,
    search: SOURCE_SEARCHERS[meta.name]?.search
  }))
    .filter((s) => typeof s.search === 'function')
    .filter((s) => !sourceFilter?.length || sourceFilter.includes(s.name));

  const results = await Promise.allSettled(
    sources.map((source) => fetchSourceWithTimeout(source.name, source.search, searchParams))
  );

  const offers = [];
  const failedSources = [];
  const sourceResults = {};

  results.forEach((result, index) => {
    const sourceName = sources[index].name;
    if (result.status === 'fulfilled') {
      const value = result.value || { items: [], status: 'error', error: 'empty_response' };
      sourceResults[sourceName] = value;
      if (value.status === 'ok') {
        for (const offer of value.items || []) {
          offers.push({ ...offer, source: sourceName });
        }
      } else if (value.status === 'error' || value.status === 'disabled') {
        failedSources.push({
          source: sourceName,
          reason: value.message || value.error || 'Erreur inconnue'
        });
      }
    } else {
      sourceResults[sourceName] = {
        items: [],
        status: 'error',
        error: 'unknown',
        message: result.reason?.message || 'Erreur inconnue'
      };
      failedSources.push({
        source: sourceName,
        reason: result.reason?.message || 'Erreur inconnue'
      });
    }
  });

  const sourcesReport = buildSourceReport(sourceResults);
  const sourceAlerts = buildSourceAlertsFromReport(sourcesReport);
  const allSourcesFailed = offers.length === 0 && failedSources.length > 0;
  const sourcesRespondedEmpty =
    offers.length === 0 && failedSources.length === 0 && Object.keys(sourceResults).length > 0;

  return {
    offers,
    failedSources,
    sources: sourcesReport,
    sourceAlerts,
    allSourcesFailed,
    sourcesRespondedEmpty
  };
}
