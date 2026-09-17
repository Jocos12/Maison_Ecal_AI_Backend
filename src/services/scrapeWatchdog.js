import ScrapeLog from '../models/ScrapeLog.js';
import {
  ORPHAN_SCAN_MESSAGE,
  SCRAPE_CRITICAL_AFTER_MS,
  SCRAPE_STALE_AFTER_MS
} from '../config/constants.js';
import { resolveAdminNotifyEmails, sendHtmlEmail } from './email.service.js';
import logger from '../utils/logger.js';

let lastOverdueAlertAt = 0;
let lastCriticalAlertAt = 0;

const ADMIN_FALLBACK = 'maisonecal@gmail.com';

export function isOrphanRestartFailure(log) {
  if (!log) return false;
  if (log.failureKind === 'orphan_restart') return true;
  return String(log.message || '').includes(ORPHAN_SCAN_MESSAGE);
}

export async function findRunningScrape() {
  return ScrapeLog.findOne({ status: 'running' }).sort({ startedAt: -1 }).lean();
}

export async function findLastSuccessfulScrape() {
  return ScrapeLog.findOne({ status: 'success' }).sort({ finishedAt: -1, startedAt: -1 }).lean();
}

/** Age used by cron skip / startup: running = 0; ignore orphan closures that look "fresh". */
export async function lastHealthyScrapeAgeMs() {
  const running = await findRunningScrape();
  if (running) return 0;
  const lastSuccess = await findLastSuccessfulScrape();
  const at = lastSuccess?.finishedAt || lastSuccess?.startedAt;
  if (!at) return Infinity;
  return Date.now() - new Date(at).getTime();
}

export async function getScrapeWatchStatus() {
  const [running, lastSuccess, lastError] = await Promise.all([
    findRunningScrape(),
    findLastSuccessfulScrape(),
    ScrapeLog.findOne({ status: 'error' }).sort({ finishedAt: -1, startedAt: -1 }).lean()
  ]);

  const healthAt = running
    ? running.startedAt
    : lastSuccess?.finishedAt || lastSuccess?.startedAt || null;
  const ageMs = healthAt ? Date.now() - new Date(healthAt).getTime() : Infinity;
  const overdue = !running && ageMs > SCRAPE_STALE_AFTER_MS;
  const critical = !running && ageMs > SCRAPE_CRITICAL_AFTER_MS;

  const errorIsNewerThanSuccess =
    lastError &&
    (!lastSuccess ||
      new Date(lastError.finishedAt || lastError.startedAt) >
        new Date(lastSuccess.finishedAt || lastSuccess.startedAt));
  const lastFailed =
    !running && Boolean(lastError) && errorIsNewerThanSuccess && !isOrphanRestartFailure(lastError);

  return {
    lastScrapeAt: healthAt,
    lastStatus: running ? 'running' : lastSuccess ? 'success' : lastError?.status || null,
    lastErrorMessage: lastFailed ? String(lastError.message || '').slice(0, 500) : '',
    lastErrorAt: lastFailed ? lastError.finishedAt || lastError.startedAt : null,
    ageMs: Number.isFinite(ageMs) ? ageMs : null,
    overdue,
    critical,
    lastFailed,
    expectedEveryMs: 30 * 60 * 1000,
    staleAfterMs: SCRAPE_STALE_AFTER_MS,
    criticalAfterMs: SCRAPE_CRITICAL_AFTER_MS
  };
}

async function notifyAdmins({ subject, html }) {
  const emails = await resolveAdminNotifyEmails();
  const recipients = [...new Set([ADMIN_FALLBACK, ...emails].filter(Boolean))];
  let sent = 0;
  for (const to of recipients) {
    try {
      await sendHtmlEmail({ to, subject, html });
      sent += 1;
    } catch (e) {
      logger.warn(`Alerte e-mail scan vers ${to}: ${e.message}`);
    }
  }
  return { sent, recipients };
}

export async function alertIfScrapeOverdueOrFailed(options = {}) {
  const watch = options.simulateAgeMs
    ? {
        ...(await getScrapeWatchStatus()),
        ageMs: options.simulateAgeMs,
        overdue: options.simulateAgeMs > SCRAPE_STALE_AFTER_MS,
        critical: options.simulateAgeMs > SCRAPE_CRITICAL_AFTER_MS
      }
    : await getScrapeWatchStatus();

  if (!watch.overdue && !watch.lastFailed && !watch.critical) return watch;

  const minutes = Math.round((watch.ageMs || 0) / 60000);
  const reason = watch.lastFailed
    ? `Dernier scan en erreur (${watch.lastStatus})${watch.lastErrorMessage ? ` — ${watch.lastErrorMessage}` : ''}`
    : `Aucun scan réussi depuis ${minutes} min (seuil ${Math.round(SCRAPE_STALE_AFTER_MS / 60000)} min)`;
  logger.error(`VEILLE 24/7 — alerte scan: ${reason}`);

  const now = Date.now();

  if (watch.critical) {
    if (options.forceCritical || now - lastCriticalAlertAt >= 2 * 60 * 60 * 1000) {
      lastCriticalAlertAt = now;
      lastOverdueAlertAt = now;
      const result = await notifyAdmins({
        subject: 'M-ECAL — scan automatique en retard de plus de 2 h',
        html: `<p>Le scan automatique M-ECAL est en retard de plus de 2h, vérifiez le planificateur externe.</p><p>Dernier scan : ${minutes} minutes.</p>`
      });
      logger.error('Alerte critique 2h envoyée', { sent: result.sent, recipientCount: result.recipients.length });
      watch.criticalEmail = result;
    }
    return watch;
  }

  if (watch.overdue) {
    if (now - lastOverdueAlertAt >= 50 * 60 * 1000) {
      lastOverdueAlertAt = now;
      await notifyAdmins({
        subject: 'M-ECAL — scan de veille en retard',
        html: `<p>${reason}</p><p>Vérifiez le planificateur externe (POST /api/internal/scrape, Authorization Bearer) ou le process Node.</p>`
      });
    }
  }

  return watch;
}
