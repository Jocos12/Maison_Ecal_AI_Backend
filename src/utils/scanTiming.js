import { AsyncLocalStorage } from 'node:async_hooks';
import logger from '../utils/logger.js';

const als = new AsyncLocalStorage();

function emptyStore() {
  return {
    t0: Date.now(),
    spans: [],
    ocr: {
      inFlight: 0,
      maxInFlight: 0,
      jobs: 0,
      cacheHits: 0,
      msSum: 0,
      cacheMsSum: 0,
      liveMsSum: 0
    },
    scoring: { n: 0, msSum: 0 },
    db: { n: 0, msSum: 0 }
  };
}

export function withScanTiming(fn) {
  return als.run(emptyStore(), fn);
}

export function getScanTiming() {
  return als.getStore() || null;
}

export async function timeSpan(name, fn, extra = {}) {
  const start = Date.now();
  logger.info(`TIMING start ${name}${extra.detail ? ` ${extra.detail}` : ''}`);
  try {
    return await fn();
  } finally {
    const ms = Date.now() - start;
    const store = als.getStore();
    if (store) store.spans.push({ name, ms, ...extra });
    logger.info(`TIMING end ${name} ${ms}ms (${(ms / 1000).toFixed(1)}s)`);
  }
}

export function recordMs(bucket, ms) {
  const store = als.getStore();
  if (!store || !store[bucket]) return;
  store[bucket].n += 1;
  store[bucket].msSum += ms;
}

export function ocrJobStart(url, { cacheHit = false } = {}) {
  const store = als.getStore();
  if (store) {
    store.ocr.inFlight += 1;
    store.ocr.maxInFlight = Math.max(store.ocr.maxInFlight, store.ocr.inFlight);
    store.ocr.jobs += 1;
    if (cacheHit) store.ocr.cacheHits += 1;
  }
  const inFlight = store?.ocr.inFlight ?? 1;
  logger.info(
    `TIMING OCR start inFlight=${inFlight} cacheHit=${cacheHit ? 1 : 0} url=${String(url || '').slice(0, 160)}`
  );
  return Date.now();
}

export function ocrJobEnd(url, startedAt, { cacheHit = false } = {}) {
  const ms = Date.now() - startedAt;
  const store = als.getStore();
  if (store) {
    store.ocr.inFlight = Math.max(0, store.ocr.inFlight - 1);
    store.ocr.msSum += ms;
    if (cacheHit) store.ocr.cacheMsSum += ms;
    else store.ocr.liveMsSum += ms;
  }
  logger.info(
    `TIMING OCR end ${ms}ms inFlight=${store?.ocr.inFlight ?? 0} cacheHit=${cacheHit ? 1 : 0} url=${String(url || '').slice(0, 160)}`
  );
}

export function summarizeScanTiming() {
  const store = als.getStore();
  if (!store) return null;
  const totalMs = Date.now() - store.t0;
  const scraperSpans = store.spans.filter((s) => s.name.startsWith('scraper:'));
  const otherSpans = store.spans.filter((s) => !s.name.startsWith('scraper:'));
  const summary = {
    totalMs,
    totalSec: Number((totalMs / 1000).toFixed(1)),
    scrapers: Object.fromEntries(scraperSpans.map((s) => [s.name.replace(/^scraper:/, ''), s.ms])),
    other: Object.fromEntries(otherSpans.map((s) => [s.name, s.ms])),
    ocrJobs: store.ocr.jobs,
    ocrCacheHits: store.ocr.cacheHits,
    ocrMaxInFlight: store.ocr.maxInFlight,
    ocrMsSum: store.ocr.msSum,
    ocrLiveMsSum: store.ocr.liveMsSum,
    ocrCacheMsSum: store.ocr.cacheMsSum,
    scoringN: store.scoring.n,
    scoringMsSum: store.scoring.msSum,
    dbN: store.db.n,
    dbMsSum: store.db.msSum
  };
  logger.info(`TIMING SUMMARY ${JSON.stringify(summary)}`);
  return summary;
}
