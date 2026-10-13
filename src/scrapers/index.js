import { analyzeOpportunity } from '../services/filterService.js';
import { upsertOpportunity } from '../services/deduplicationService.js';
import { sendWhatsAppNewOpportunity } from '../services/notificationService.js';
import { scoreOpportunityForMecal } from '../services/mecalMatchService.js';
import { resetAiUsage, getAiUsage, primaryAiProvider } from '../services/aiService.js';
import User from '../models/User.js';
import { scrapeReliefWeb } from './reliefweb.js';
import { scrapeUngm } from './ungm.js';
import { scrapeDevex } from './devex.js';
import { scrapeProfilRdc } from './profilrdc.js';
import { scrapeAchatPublicRdc } from './achatpublicrdc.js';
import { scrapeDevexVeille } from './veille/devexVeille.js';
import { scrapeUngmLogisticsVeille } from './veille/ungmLogisticsVeille.js';
import { scrapeAfdb } from './afdb.js';
import { scrapeAfdbVeille } from './veille/afdbVeille.js';
import { scrapeSigmap } from './sigmap.js';
import { scrapeArsp } from './arsp.js';
import logger from '../utils/logger.js';
import Source from '../models/Source.js';
import ScrapeLog from '../models/ScrapeLog.js';
import { ensureDefaultSources, getActiveScraperKeys } from '../services/sourceService.js';
import {
  archiveInactiveOpportunities,
  backfillFingerprints,
  clearStaleNewFlags,
  isDeadlineExpired
} from '../services/opportunityLifecycle.js';
import { recordEcalMatchAlert, isEcalRelevantMatch } from '../services/matchAlertService.js';
import { recordScanFailureAlert } from '../services/scanAlertService.js';
import { ORPHAN_SCAN_MESSAGE, SCAN_TIMEOUT_MS } from '../config/constants.js';
import { enrichItemDates } from './dateExtract.js';
import { withScanTiming, timeSpan, recordMs, summarizeScanTiming } from '../utils/scanTiming.js';
import { ratesForScrapeLogPersist } from '../services/scanRelevanceStats.js';
import { scheduleStrictMecalMatchAfterScan } from '../services/strictMecalMatchJob.js';

function isUrgent(deadline) {
  if (!deadline) return false;
  const d = new Date(deadline);
  const now = new Date();
  const diff = (d - now) / (1000 * 60 * 60 * 24);
  return diff >= 0 && diff <= 7;
}

async function shouldNotifyImmediate() {
  const u = await User.findOne({ alertsEnabled: true, alertFrequency: 'immediate' });
  return Boolean(u);
}

/**
 * Process raw scraper rows: filter → optional AI → save → WhatsApp if new & immediate
 */
export async function ingestRawItems(rawItems) {
  let saved = 0;
  let skipped = 0;
  let scoredCount = 0;
  let recommendedCount = 0;
  const createdIds = [];
  const skipReasons = {};
  const skippedItems = [];
  const retainedByPlatform = {};
  const MAX_SKIPPED_ITEMS = 400;

  const trackSkip = (reason, row = {}, extra = {}) => {
    skipped++;
    const key = reason || 'unknown';
    skipReasons[key] = (skipReasons[key] || 0) + 1;
    if (skippedItems.length >= MAX_SKIPPED_ITEMS) return;

    let score = extra.score;
    if (score != null && score <= 1) score = Math.round(score * 100);
    else if (score != null) score = Math.round(score);

    skippedItems.push({
      reasonKey: key,
      title: String(row.title || 'Sans titre').slice(0, 300),
      description: String(row.description || '').slice(0, 800),
      source: row.platform || row.organization || 'Inconnue',
      organization: row.organization || '',
      platform: row.platform || '',
      date: row.postedDate ? new Date(row.postedDate) : new Date(),
      url: row.sourceUrl || '',
      score: score ?? null
    });
  };

  const users = await User.find({ keywords: { $exists: true, $ne: [] } }).select('keywords').lean();
  const extraInclude = [...new Set(users.flatMap((u) => u.keywords || []).filter(Boolean))];

  for (const raw of rawItems) {
    const row = raw.skipDateEnrich ? raw : enrichItemDates(raw);
    if (!row.sourceUrl || !row.title) {
      trackSkip('missing_fields', row);
      continue;
    }

    const expired = isDeadlineExpired(row.deadline);
    const analysis = analyzeOpportunity(
      {
        title: row.title,
        description: row.description || '',
        organization: row.organization || '',
        location: row.location || '',
        platform: row.platform || ''
      },
      { extraInclude }
    );
    if (!analysis.accept) {
      trackSkip(analysis.reason, row);
      continue;
    }

    if (expired) {
      try {
        const { created } = await upsertOpportunity({
          title: row.title,
          description: row.description || '',
          organization: row.organization || '',
          platform: row.platform,
          category: analysis.category || 'consultance',
          location: row.location || '',
          locationStatus: analysis.locationStatus || 'rdc_confirme',
          ville: analysis.ville || 'RDC',
          deadline: row.deadline,
          postedDate: row.postedDate || undefined,
          deadlineUnspecified: false,
          sourceUrl: row.sourceUrl,
          isUrgent: false,
          isArchived: true,
          expiredReason: 'deadline_passed',
          isNew: false,
          rawKeywords: analysis.rawKeywords
        });
        if (created) {
          logger.info(`Ingest: offre expirée archivée d'emblée — ${row.title?.slice(0, 80)}`);
        }
      } catch (e) {
        if (e.code !== 11000) logger.warn(`ingest expired: ${e.message}`);
      }
      continue;
    }

    let aiScore = null;
    let aiAnalysis = null;
    let category = analysis.category;
    let locationStatus = analysis.locationStatus || 'a_verifier';
    let ville = analysis.ville || 'Non précisé';
    const needsAiReview = analysis.needsAiReview && !category;

    if (needsAiReview) {
      category = 'consultance';
      locationStatus = 'rdc_confirme';
    }
    if (!category) {
      trackSkip('no_category', row);
      continue;
    }

    if (locationStatus !== 'rdc_confirme') {
      trackSkip('hors_rdc', row);
      continue;
    }

    const scoreStarted = Date.now();
    const match = await scoreOpportunityForMecal(row, analysis);
    recordMs('scoring', Date.now() - scoreStarted);
    scoredCount += 1;
    retainedByPlatform[row.platform || 'unknown'] = (retainedByPlatform[row.platform || 'unknown'] || 0) + 1;
    if (match.recommended) recommendedCount += 1;
    aiScore = match.score;
    aiAnalysis = {
      est_service: true,
      est_emploi: false,
      type: 'service',
      score: Math.round(match.score * 100),
      categorie: category,
      pays_confirme_rdc: 'true',
      justification: match.justification,
      recommandation: match.recommended ? 'POSTULER' : 'EVALUER',
      raison: match.justification,
      ville_confirmee: ville
    };

    const payload = {
      title: row.title,
      description: row.description || '',
      organization: row.organization || '',
      platform: row.platform,
      category,
      location: row.location || '',
      locationStatus,
      ville,
      deadline: row.deadline || undefined,
      postedDate: row.postedDate || undefined,
      deadlineUnspecified: !row.deadline,
      sourceUrl: row.sourceUrl,
      isUrgent: isUrgent(row.deadline),
      isArchived: false,
      expiredReason: undefined,
      isRecommended: match.recommended,
      aiScoringProvider: match.provider,
      rawKeywords: analysis.rawKeywords,
      ...(aiScore != null ? { aiRelevanceScore: aiScore } : {}),
      ...(aiAnalysis ? { aiAnalysis } : {})
    };

    try {
      const dbStarted = Date.now();
      const { created, doc } = await upsertOpportunity(payload);
      recordMs('db', Date.now() - dbStarted);
      if (created) {
        saved++;
        createdIds.push(doc._id);
        if (isEcalRelevantMatch(match, doc)) {
          await recordEcalMatchAlert({ doc, match });
        }
        const notify = await shouldNotifyImmediate();
        if (notify) {
          await sendWhatsAppNewOpportunity(doc).catch((e) => logger.warn(e.message));
        }
      }
    } catch (e) {
      if (e.code === 11000) trackSkip('duplicate', row);
      else logger.warn(`ingest: ${e.message}`);
    }
  }

  if (skipped > 0) {
    logger.info(`Ingest filtres: ${JSON.stringify(skipReasons)}`);
  }

  return { saved, skipped, createdIds, skipReasons, skippedItems, scoredCount, recommendedCount, retainedByPlatform };
}

const SCRAPERS = {
  ReliefWeb: scrapeReliefWeb,
  UNGM: scrapeUngm,
  DevEx: scrapeDevex,
  ProfilRDC: scrapeProfilRdc,
  AchatPublicRDC: scrapeAchatPublicRdc,
  SIGMAP: scrapeSigmap,
  ARSP: scrapeArsp,
  AfDB: scrapeAfdb,
  DevExVeille: scrapeDevexVeille,
  UNGMVeille: scrapeUngmLogisticsVeille,
  AfDBVeille: scrapeAfdbVeille
};

let scrapeInFlight = null;

const SCAN_TIMEOUT_MESSAGE = `Timeout - scan interrompu après ${Math.round(SCAN_TIMEOUT_MS / 60000)} minutes`;

class ScanTimeoutError extends Error {
  constructor() {
    super(SCAN_TIMEOUT_MESSAGE);
    this.name = 'ScanTimeoutError';
    this.code = 'SCAN_TIMEOUT';
    this.status = 504;
  }
}

function withTimeout(promise, ms, onTimeout) {
  let timer;
  const timeoutPromise = new Promise((_, reject) => {
    timer = setTimeout(() => {
      onTimeout?.();
      reject(new ScanTimeoutError());
    }, ms);
  });
  return Promise.race([promise, timeoutPromise]).finally(() => clearTimeout(timer));
}

async function persistScanFailure(logId, { message, stack, errors, kind = 'pipeline', triggeredBy = '' }) {
  if (!logId) return;
  const text = [message, stack].filter(Boolean).join('\n').slice(0, 8000);
  const failureKind = kind === 'timeout' || kind === 'orphan_restart' ? kind : 'pipeline';
  await ScrapeLog.findByIdAndUpdate(logId, {
    $set: {
      status: 'error',
      finishedAt: new Date(),
      message: text,
      failureKind,
      errors: errors?.length ? errors : [{ source: failureKind === 'timeout' ? 'timeout' : 'pipeline', message }]
    }
  });
  await recordScanFailureAlert({
    scrapeLogId: logId,
    message: text,
    kind: failureKind,
    triggeredBy
  });
}

async function failOrphanRunningLogs() {
  const orphans = await ScrapeLog.find({ status: 'running' }).select('_id triggeredBy').lean();
  if (!orphans.length) return;
  const res = await ScrapeLog.updateMany(
    { _id: { $in: orphans.map((o) => o._id) } },
    {
      $set: {
        status: 'error',
        finishedAt: new Date(),
        message: ORPHAN_SCAN_MESSAGE,
        failureKind: 'orphan_restart',
        errors: [{ source: 'pipeline', message: ORPHAN_SCAN_MESSAGE }]
      }
    }
  );
  const n = res.modifiedCount ?? res.nModified ?? 0;
  if (n > 0) {
    logger.warn(`Logs de scan orphelins (running) clôturés: ${n}`);
    await recordScanFailureAlert({
      scrapeLogId: orphans[0]._id,
      message: `${n} collecte(s) restée(s) « running » clôturée(s) : ${ORPHAN_SCAN_MESSAGE}`,
      kind: 'orphan_restart',
      triggeredBy: 'process-restart'
    });
  }
}

export function isScrapeInFlight() {
  return Boolean(scrapeInFlight);
}

/** Scrapers that answer in seconds. SIGMAP takes 30 s and ProfilRDC and AchatPublicRDC (OCR of PDFs) take minutes and are left to the scheduled full scan. */
export const QUICK_SCRAPER_KEYS = ['ReliefWeb', 'UNGM', 'ARSP', 'AfDB', 'UNGMVeille', 'AfDBVeille'];
const QUICK_PARALLEL_KEYS = ['ReliefWeb', 'UNGM', 'ARSP', 'AfDB'];

export async function runAllScrapers({ triggeredBy = 'manual', onlyKeys = null, parallel = false } = {}) {
  if (scrapeInFlight) {
    logger.info(`Scrape ignoré (déjà en cours) — trigger=${triggeredBy}`);
    return scrapeInFlight;
  }

  scrapeInFlight = withScanTiming(async () => {
    let log = null;
    const errors = [];
    const abortState = { timedOut: false };

    try {
      await failOrphanRunningLogs();
      log = await ScrapeLog.create({ status: 'running', triggeredBy });

      const work = (async () => {
        resetAiUsage();
        logger.info(
          `TIMING env OCR_CONCURRENCY=${process.env.OCR_CONCURRENCY || '(unset→4)'} ARMP_DETAIL_CONCURRENCY=${process.env.ARMP_DETAIL_CONCURRENCY || '(unset→3)'} SCAN_TIMEOUT_MS=${SCAN_TIMEOUT_MS}`
        );
        await timeSpan('setup_sources', () => ensureDefaultSources());
        const archivedStart = await timeSpan('archive_start', () => archiveInactiveOpportunities());
        await timeSpan('clear_stale_flags', () => clearStaleNewFlags());
        await timeSpan('backfill_fingerprints', () => backfillFingerprints());

        const activeScraperKeys = await getActiveScraperKeys();
        const results = Object.fromEntries(Object.keys(SCRAPERS).map((key) => [key, []]));
        // Quick mode still respects the sources the admin switched off.
        const only =
          Array.isArray(onlyKeys) && onlyKeys.length
            ? new Set(onlyKeys.filter((key) => !parallel || activeScraperKeys.has(key)))
            : null;

        const runOne = async (key, scraper) => {
          try {
            results[key] = await timeSpan(`scraper:${key}`, () => scraper());
            logger.info(`Scraper ${key}: ${results[key].length} raw`);
            const rawN = Array.isArray(results[key]) ? results[key].length : 0;
            await Source.updateOne(
              { scraperKey: key },
              {
                $set: {
                  lastScrapedAt: new Date(),
                  lastStatus: rawN > 0 ? 'success' : 'idle',
                  lastRawCount: rawN,
                  lastErrorMessage: ''
                }
              }
            );
          } catch (e) {
            errors.push({ source: key, message: e.message });
            await Source.updateOne(
              { scraperKey: key },
              { $set: { lastStatus: 'error', lastErrorMessage: String(e.message || '').slice(0, 400) } }
            );
            logger.warn(`Scraper ${key}: ${e.message}`);
          }
        };

        // Quick mode: the independent scrapers run side by side, so the scan lasts as long as the slowest one.
        const preDone = new Set();
        if (parallel && only) {
          const batch = Object.entries(SCRAPERS).filter(
            ([key]) => QUICK_PARALLEL_KEYS.includes(key) && only.has(key)
          );
          await Promise.all(batch.map(([key, scraper]) => runOne(key, scraper)));
          batch.forEach(([key]) => preDone.add(key));
        }

        for (const [key, scraper] of Object.entries(SCRAPERS)) {
          if (abortState.timedOut) break;
          if (only) {
            if (!only.has(key)) continue;
          } else if (!activeScraperKeys.has(key)) {
            continue;
          }
          if ((key === 'DevEx' || key === 'DevExVeille') && process.env.DEVEX_DISABLED !== 'false') {
            logger.info(`Scraper ${key}: ignoré (paywall Devex Pro — DEVEX_DISABLED=false pour forcer)`);
            continue;
          }
          if (key === 'AfDBVeille' && activeScraperKeys.has('AfDB')) {
            results[key] = results.AfDB || [];
            logger.info('Scraper AfDBVeille: réutilise le résultat AfDB (même corpus RDC)');
            continue;
          }
          if (key === 'UNGMVeille' && activeScraperKeys.has('UNGM') && results.UNGM?.length) {
            const { filterUngmLogisticsVeilleItems } = await import('../config/veilleSourceFilters.js');
            results[key] = filterUngmLogisticsVeilleItems(results.UNGM).map((item) => ({
              ...item,
              platform: 'UNGM',
              location: item.location || 'RDC — Democratic Republic of the Congo'
            }));
            logger.info(`Scraper UNGMVeille: ${results[key].length} depuis UNGM déjà lu`);
            continue;
          }
          if (preDone.has(key)) continue;
          await runOne(key, scraper);
        }

        if (abortState.timedOut) {
          throw new ScanTimeoutError();
        }

        const seenUrls = new Set();
        const flat = [];
        for (const items of Object.values(results)) {
          for (const item of items) {
            const url = item?.sourceUrl;
            if (!url || seenUrls.has(url)) continue;
            seenUrls.add(url);
            flat.push(item);
          }
        }
        const summary = await timeSpan('ingest_filter_score_db', () => ingestRawItems(flat));
        if (abortState.timedOut) {
          throw new ScanTimeoutError();
        }
        const archivedEnd = await timeSpan('archive_end', () => archiveInactiveOpportunities());
        const archivedExpired = archivedStart.archivedExpired + archivedEnd.archivedExpired;
        const archivedStale = archivedStart.archivedStale + archivedEnd.archivedStale;
        const archivedTotal = archivedExpired + archivedStale;
        const scannedKeys = [...activeScraperKeys].filter((key) => SCRAPERS[key]);

        const aiProviders = getAiUsage();
        const aiProvider = primaryAiProvider(aiProviders);
        const payload = {
          ...summary,
          totalRaw: flat.length,
          archivedExpired,
          archivedStale,
          archivedTotal,
          sourcesScanned: scannedKeys.length,
          aiProvider,
          aiProviders,
          scoredCount: summary.scoredCount || 0,
          recommendedCount: summary.recommendedCount || 0,
          byPlatform: Object.fromEntries(Object.entries(results).map(([k, v]) => [k, v.length])),
          errors,
          message: errors.length ? errors.map((e) => `${e.source}: ${e.message}`).join(' | ') : '',
          ...ratesForScrapeLogPersist({
            totalRaw: flat.length,
            skipped: summary.skipped || 0,
            scoredCount: summary.scoredCount || 0,
            recommendedCount: summary.recommendedCount || 0,
            skipReasons: summary.skipReasons || {}
          })
        };

        if (abortState.timedOut) {
          throw new ScanTimeoutError();
        }

        await ScrapeLog.findOneAndUpdate(
          { _id: log._id, status: 'running' },
          {
            $set: {
              ...payload,
              status: errors.length && flat.length === 0 ? 'error' : 'success',
              finishedAt: new Date()
            }
          }
        );
        logger.info(
          `${flat.length} offres lues, ${summary.saved} nouvelles ajoutées, ${archivedTotal} expirées retirées | IA=${aiProvider || 'keywords'} scorées=${summary.scoredCount || 0} recommandées=${summary.recommendedCount || 0} usage=${JSON.stringify(aiProviders)}`
        );
        scheduleStrictMecalMatchAfterScan();
        return payload;
      })();

      work.catch((e) => {
        if (abortState.timedOut) {
          logger.warn(`Suite du scan ignorée après timeout: ${e?.message || e}`);
        }
      });

      return await withTimeout(work, SCAN_TIMEOUT_MS, () => {
        abortState.timedOut = true;
        logger.error(SCAN_TIMEOUT_MESSAGE, { triggeredBy, logId: String(log._id) });
      });
    } catch (e) {
      const message = e?.message || String(e);
      const stack = e?.stack || '';
      logger.error(e instanceof Error ? e : new Error(message));
      logger.error(`Scan en échec (trigger=${triggeredBy}): ${message}`);
      const pipelineErrors = [
        ...errors,
        { source: e?.code === 'SCAN_TIMEOUT' ? 'timeout' : 'pipeline', message }
      ];
      await persistScanFailure(log?._id, {
        message,
        stack,
        errors: pipelineErrors,
        kind: e?.code === 'SCAN_TIMEOUT' ? 'timeout' : 'pipeline',
        triggeredBy
      });
      throw e;
    } finally {
      if (log?._id) {
        try {
          const current = await ScrapeLog.findById(log._id).select('status').lean();
          if (current?.status === 'running') {
            const message = abortState.timedOut
              ? SCAN_TIMEOUT_MESSAGE
              : 'Scan interrompu avant la mise à jour du statut final';
            logger.error(message);
            await persistScanFailure(log._id, {
              message,
              errors: [...errors, { source: 'pipeline', message }],
              kind: abortState.timedOut ? 'timeout' : 'pipeline',
              triggeredBy
            });
          }
        } catch (finalizeErr) {
          logger.error(finalizeErr instanceof Error ? finalizeErr : new Error(String(finalizeErr)));
        }
      }
      summarizeScanTiming();
    }
  });

  try {
    return await scrapeInFlight;
  } finally {
    scrapeInFlight = null;
  }
}

export {
  scrapeReliefWeb,
  scrapeUngm,
  scrapeDevex,
  scrapeProfilRdc,
  scrapeAchatPublicRdc,
  scrapeSigmap,
  scrapeArsp,
  scrapeDevexVeille,
  scrapeUngmLogisticsVeille,
  scrapeAfdbVeille,
  scrapeAfdb
};
