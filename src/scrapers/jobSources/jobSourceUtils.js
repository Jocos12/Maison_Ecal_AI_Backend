/**
 * Utilitaires partagés pour les sources HTML de l'Assistant Emploi :
 * cache court, circuit breaker, respect robots.txt, espacement des requêtes.
 */
import { fetchHtml, absoluteUrl } from '../utils.js';
import logger from '../../utils/logger.js';

const CACHE_TTL_MS = Number(process.env.JOB_SCRAPE_CACHE_TTL_MS) || 90 * 60 * 1000;
const CIRCUIT_FAILURE_THRESHOLD = Number(process.env.JOB_SOURCE_CIRCUIT_FAILURES) || 3;
const CIRCUIT_COOLDOWN_MS = Number(process.env.JOB_SOURCE_CIRCUIT_COOLDOWN_MS) || 30 * 60 * 1000;

const resultCache = new Map();
const robotsCache = new Map();
const lastRequestByHost = new Map();
const circuitState = new Map();

export function getJobScraperUserAgent() {
  return (
    process.env.JOB_SCRAPER_USER_AGENT ||
    process.env.USER_AGENT ||
    'Mozilla/5.0 (compatible; M-ECAL-JobAssistant/1.0; +https://maison-ecal.com/assistant-emploi)'
  );
}

function cacheKey(sourceName, key) {
  return `${sourceName}::${key}`;
}

export function getCachedScrapeResult(sourceName, key) {
  const entry = resultCache.get(cacheKey(sourceName, key));
  if (!entry) return null;
  if (Date.now() > entry.expiresAt) {
    resultCache.delete(cacheKey(sourceName, key));
    return null;
  }
  return entry.value;
}

export function setCachedScrapeResult(sourceName, key, value) {
  resultCache.set(cacheKey(sourceName, key), {
    value,
    expiresAt: Date.now() + CACHE_TTL_MS
  });
}

function getCircuit(sourceName) {
  if (!circuitState.has(sourceName)) {
    circuitState.set(sourceName, { failures: 0, openUntil: 0 });
  }
  return circuitState.get(sourceName);
}

export function getCircuitBreakerStatus(sourceName) {
  const circuit = getCircuit(sourceName);
  if (circuit.openUntil > Date.now()) {
    const retryInMin = Math.ceil((circuit.openUntil - Date.now()) / 60000);
    return {
      disabled: true,
      retryInMin,
      message: `Source ${sourceName} temporairement désactivée après plusieurs échecs — nouvelle tentative dans ${retryInMin} min`
    };
  }
  return { disabled: false };
}

export function recordSourceSuccess(sourceName) {
  const circuit = getCircuit(sourceName);
  circuit.failures = 0;
  circuit.openUntil = 0;
}

export function recordSourceFailure(sourceName) {
  const circuit = getCircuit(sourceName);
  circuit.failures += 1;
  if (circuit.failures >= CIRCUIT_FAILURE_THRESHOLD) {
    circuit.openUntil = Date.now() + CIRCUIT_COOLDOWN_MS;
    logger.warn(
      `[JobAssistant] Circuit breaker ouvert pour ${sourceName} (${CIRCUIT_FAILURE_THRESHOLD} échecs)`
    );
  }
}

function parseRobotsRules(text, userAgent) {
  const lines = text.split(/\r?\n/);
  const groups = [];
  let current = { agents: [], rules: [] };

  for (const raw of lines) {
    const line = raw.split('#')[0].trim();
    if (!line) continue;
    const [directive, ...rest] = line.split(':');
    const value = rest.join(':').trim();
    const key = directive.toLowerCase();

    if (key === 'user-agent') {
      if (current.agents.length || current.rules.length) groups.push(current);
      current = { agents: [value.toLowerCase()], rules: [] };
    } else if (key === 'allow' || key === 'disallow') {
      current.rules.push({ type: key, path: value || '/' });
    } else if (key === 'crawl-delay') {
      const delaySec = Number(value);
      if (!Number.isNaN(delaySec)) current.crawlDelaySec = delaySec;
    }
  }
  if (current.agents.length || current.rules.length) groups.push(current);

  const ua = userAgent.toLowerCase();
  let matched = groups.filter((g) => g.agents.includes('*'));
  const specific = groups.find((g) => g.agents.some((a) => a !== '*' && ua.includes(a)));
  if (specific) matched = [specific, ...matched.filter((g) => g !== specific)];

  let crawlDelaySec = 0;
  for (const group of matched) {
    if (group.crawlDelaySec) crawlDelaySec = Math.max(crawlDelaySec, group.crawlDelaySec);
  }

  return { groups: matched, crawlDelaySec };
}

function isPathAllowed(pathname, rules = []) {
  if (!rules.length) return true;
  let allowed = true;
  for (const rule of rules) {
    if (!rule.path) continue;
    const prefix = rule.path === '/' ? '/' : rule.path;
    const matches = prefix === '/' || pathname.startsWith(prefix);
    if (!matches) continue;
    allowed = rule.type === 'allow';
  }
  return allowed;
}

export async function checkRobotsAllowed(targetUrl, { userAgent = getJobScraperUserAgent() } = {}) {
  const url = new URL(targetUrl);
  const robotsUrl = `${url.origin}/robots.txt`;
  const cacheId = `${robotsUrl}::${userAgent}`;
  const cached = robotsCache.get(cacheId);
  if (cached && cached.expiresAt > Date.now()) {
    return { ...cached.value, crawlDelayMs: cached.crawlDelayMs };
  }

  try {
    const text = await fetchHtml(robotsUrl, {
      timeout: 12000,
      headers: { 'User-Agent': userAgent }
    });
    const parsed = parseRobotsRules(text, userAgent);
    const rules = parsed.groups.flatMap((g) => g.rules);
    const allowed = isPathAllowed(url.pathname, rules);
    const crawlDelayMs = (parsed.crawlDelaySec || 0) * 1000;
    const value = { allowed, reason: allowed ? null : 'robots_txt_disallow', crawlDelayMs };
    robotsCache.set(cacheId, { value, crawlDelayMs, expiresAt: Date.now() + 24 * 60 * 60 * 1000 });
    return value;
  } catch (e) {
    logger.warn(`[JobAssistant] robots.txt illisible pour ${url.origin}: ${e.message}`);
    return { allowed: true, reason: 'robots_unavailable', crawlDelayMs: 0 };
  }
}

export async function enforceCrawlDelay(targetUrl, minDelayMs = 0) {
  const host = new URL(targetUrl).host;
  const robots = await checkRobotsAllowed(targetUrl);
  const delayMs = Math.max(minDelayMs, robots.crawlDelayMs || 0);
  const last = lastRequestByHost.get(host) || 0;
  const wait = delayMs - (Date.now() - last);
  if (wait > 0) {
    await new Promise((r) => setTimeout(r, wait));
  }
  lastRequestByHost.set(host, Date.now());
}

export async function fetchHtmlForScrape(url, { sourceName, minCrawlDelayMs = 0 } = {}) {
  await enforceCrawlDelay(url, minCrawlDelayMs);
  return fetchHtml(url, {
    timeout: 25000,
    headers: {
      'User-Agent': getJobScraperUserAgent(),
      Accept: 'text/html,application/xhtml+xml',
      'Accept-Language': 'fr-FR,fr;q=0.9,en;q=0.8'
    }
  });
}

export async function withScrapeGuards(sourceName, cacheKeyPart, scrapeFn, { minCrawlDelayMs = 0 } = {}) {
  const circuit = getCircuitBreakerStatus(sourceName);
  if (circuit.disabled) {
    return {
      items: [],
      status: 'disabled',
      error: 'circuit_open',
      message: circuit.message
    };
  }

  const cached = getCachedScrapeResult(sourceName, cacheKeyPart);
  if (cached) {
    logger.info(`[JobAssistant] ${sourceName}: cache hit (${cached.items?.length ?? 0} items)`);
    return { ...cached, fromCache: true };
  }

  try {
    const result = await scrapeFn();
    if (result.status === 'ok') {
      recordSourceSuccess(sourceName);
      setCachedScrapeResult(sourceName, cacheKeyPart, result);
    } else if (result.status === 'error') {
      recordSourceFailure(sourceName);
    }
    return result;
  } catch (e) {
    recordSourceFailure(sourceName);
    const code = e.response?.status || 'unknown';
    return {
      items: [],
      status: 'error',
      error: String(code),
      message: e.message
    };
  }
}

export function resolveScrapeUrl(base, href) {
  return absoluteUrl(base, href);
}
