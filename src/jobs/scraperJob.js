import cron from 'node-cron';
import Opportunity from '../models/Opportunity.js';
import { runAllScrapers } from '../scrapers/index.js';
import { sendDailyDigestEmail } from '../services/notificationService.js';
import {
  archiveInactiveOpportunities,
  clearStaleNewFlags
} from '../services/opportunityLifecycle.js';
import User from '../models/User.js';
import { alertIfScrapeOverdueOrFailed, lastHealthyScrapeAgeMs } from '../services/scrapeWatchdog.js';
import logger from '../utils/logger.js';
import { SCRAPE_SAFETY_NET_MS } from '../config/constants.js';

const SCRAPE_CRON = process.env.SCRAPE_CRON || '*/30 * * * *';

function daysFromNow(d) {
  return (new Date(d) - new Date()) / (1000 * 60 * 60 * 24);
}

export async function checkUpcomingDeadlines() {
  const soon = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);
  await archiveInactiveOpportunities();
  await Opportunity.updateMany(
    {
      isArchived: false,
      deadline: { $gte: new Date(), $lte: soon }
    },
    { $set: { isUrgent: true } }
  );
  await Opportunity.updateMany(
    {
      isArchived: false,
      $or: [{ deadline: null }, { deadline: { $gt: soon } }, { deadline: { $lt: new Date() } }]
    },
    { $set: { isUrgent: false } }
  );
}

export async function sendDailyDigest() {
  const since = new Date(Date.now() - 24 * 60 * 60 * 1000);
  const list = await Opportunity.find({
    createdAt: { $gte: since },
    isArchived: false
  })
    .sort({ createdAt: -1 })
    .lean();
  const users = await User.find({ alertsEnabled: true, alertFrequency: 'daily' });
  const emails = [...new Set(users.map((u) => u.digestEmail || u.email).filter(Boolean))];
  if (list.length === 0) {
    logger.info('Daily digest: no new items');
    return;
  }
  if (emails.length === 0) {
    await sendDailyDigestEmail(list).catch((e) => logger.warn(e.message));
  } else {
    for (const to of emails) {
      await sendDailyDigestEmail(list, to).catch((e) => logger.warn(e.message));
    }
  }
}

export async function runScheduledScrape(triggeredBy) {
  logger.info(`Cron: runAllScrapers (${triggeredBy})`);
  try {
    await runAllScrapers({ triggeredBy });
  } catch (e) {
    logger.error(e);
  }
}

async function lastFinishedScrapeAgeMs() {
  return lastHealthyScrapeAgeMs();
}

export async function maybeRunStartupScrape() {
  const ageMs = await lastFinishedScrapeAgeMs();
  const maxAge = Number(process.env.SCRAPE_STARTUP_MAX_AGE_MS || 2 * 60 * 60 * 1000);
  if (ageMs < maxAge) {
    logger.info('Startup scrape skipped — last collection still recent');
    return;
  }
  const delayMs = Number(process.env.SCRAPE_STARTUP_DELAY_MS || 20000);
  setTimeout(() => {
    runScheduledScrape('startup').catch((e) => logger.error(e));
  }, delayMs);
  logger.info(`Startup scrape scheduled in ${Math.round(delayMs / 1000)}s`);
}

export function startScraperJobs() {
  cron.schedule(SCRAPE_CRON, async () => {
    const ageMs = await lastFinishedScrapeAgeMs();
    if (ageMs < SCRAPE_SAFETY_NET_MS) {
      logger.info(
        `Cron 30 min filet: skip — dernier scan il y a ${Math.round(ageMs / 60000)} min`
      );
      return;
    }
    await runScheduledScrape(`cron-safety-net-${SCRAPE_CRON}`);
  });

  cron.schedule('*/15 * * * *', async () => {
    try {
      await alertIfScrapeOverdueOrFailed();
    } catch (e) {
      logger.error(e);
    }
  });

  // 7:00 Kinshasa (UTC+1) → 06:00 UTC
  cron.schedule('0 6 * * *', async () => {
    logger.info('Cron: deadlines + digest');
    try {
      await checkUpcomingDeadlines();
      await clearStaleNewFlags();
      await sendDailyDigest();
    } catch (e) {
      logger.error(e);
    }
  });

  logger.info(`Scraper cron schedules registered (toutes les 30 min ${SCRAPE_CRON} + watchdog 15 min + daily 06:00 UTC)`);
  void maybeRunStartupScrape();
}

export { daysFromNow };
