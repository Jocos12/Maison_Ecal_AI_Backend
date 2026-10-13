import cron from 'node-cron';
import logger from '../utils/logger.js';
import { reclassifyStored, syncIsStale, syncNrc } from '../services/nrcService.js';

const NRC_CRON = process.env.NRC_CRON || '15 */6 * * *';
const STALE_MS = 6 * 60 * 60 * 1000;

/**
 * NRC tenders and vacancies: a pass every six hours, and one shortly after start-up when the last one is old.
 * A pass spaces its requests to nrc.no by 20 seconds (their robots.txt), so it runs in the background for a while.
 * Set NRC_DISABLED=true to switch it off.
 */
export function startNrcJobs() {
  if (process.env.NRC_DISABLED === 'true') {
    logger.info('NRC: collecte désactivée (NRC_DISABLED=true)');
    return;
  }
  reclassifyStored().catch((e) => logger.error(`NRC reclassement: ${e.message}`));
  cron.schedule(NRC_CRON, () => {
    syncNrc({ trigger: 'cron' }).catch((e) => logger.error(`NRC cron: ${e.message}`));
  });
  setTimeout(async () => {
    try {
      if (await syncIsStale(STALE_MS)) await syncNrc({ trigger: 'startup' });
      else logger.info('NRC: dernière collecte encore récente, pas de collecte au démarrage');
    } catch (e) {
      logger.error(`NRC démarrage: ${e.message}`);
    }
  }, Number(process.env.NRC_STARTUP_DELAY_MS || 45000));
  logger.info(`NRC: collecte planifiée (${NRC_CRON})`);
}
