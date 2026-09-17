import Opportunity from '../models/Opportunity.js';
import { classifyStrictMecalMatch } from './strictMecalMatchService.js';
import { activeOpportunityFilter } from './opportunityLifecycle.js';
import logger from '../utils/logger.js';

let inFlight = null;

function pendingStrictFilter() {
  return activeOpportunityFilter({
    $or: [{ strictMecalMatch: { $exists: false } }, { 'strictMecalMatch.status': { $exists: false } }]
  });
}

/**
 * Remplit uniquement strictMecalMatch. Ne touche jamais à category / isArchived.
 */
export async function runStrictMecalMatchBackfill() {
  const pending = await Opportunity.find(pendingStrictFilter())
    .select('title description organization platform location')
    .lean();

  let classified = 0;
  let failed = 0;
  const tallies = { metier_confirme: 0, hors_metier: 0, a_verifier: 0 };

  for (const row of pending) {
    try {
      const result = await classifyStrictMecalMatch(row);
      await Opportunity.updateOne({ _id: row._id }, { $set: { strictMecalMatch: result } });
      classified += 1;
      if (tallies[result.status] != null) tallies[result.status] += 1;
    } catch (e) {
      failed += 1;
      logger.warn(`strictMecalMatch: ${row.title?.slice(0, 80)} — ${e.message}`);
    }
  }

  logger.info(
    `strictMecalMatch backfill: ${classified}/${pending.length} classées (confirmé=${tallies.metier_confirme} hors=${tallies.hors_metier} à vérifier=${tallies.a_verifier} échecs=${failed})`
  );
  return { pending: pending.length, classified, failed, ...tallies };
}

export function scheduleStrictMecalMatchAfterScan() {
  if (inFlight) return;
  inFlight = runStrictMecalMatchBackfill()
    .catch((e) => logger.warn(`strictMecalMatch after-scan: ${e.message}`))
    .finally(() => {
      inFlight = null;
    });
}
