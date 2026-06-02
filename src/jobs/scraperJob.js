import cron from 'node-cron';
import Opportunity from '../models/Opportunity.js';
import { runAllScrapers } from '../scrapers/index.js';
import { sendDailyDigestEmail } from '../services/notificationService.js';
import User from '../models/User.js';
import logger from '../utils/logger.js';

function daysFromNow(d) {
  return (new Date(d) - new Date()) / (1000 * 60 * 60 * 24);
}

export async function checkUpcomingDeadlines() {
  const soon = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);
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

export function startScraperJobs() {
  cron.schedule('0 */6 * * *', async () => {
    logger.info('Cron: runAllScrapers');
    try {
      await runAllScrapers({ triggeredBy: 'cron-6h' });
    } catch (e) {
      logger.error(e);
    }
  });

  // 7:00 Kinshasa (UTC+1) → 06:00 UTC
  cron.schedule('0 6 * * *', async () => {
    logger.info('Cron: deadlines + digest');
    try {
      await checkUpcomingDeadlines();
      await sendDailyDigest();
    } catch (e) {
      logger.error(e);
    }
  });

  logger.info('Scraper cron schedules registered');
}
