/**
 * Classifie les offres actives sans strictMecalMatch.
 * N'écrit que le champ strictMecalMatch.
 */
import '../src/loadEnv.js';
import { connectDb } from '../src/config/db.js';
import Opportunity from '../src/models/Opportunity.js';
import { runStrictMecalMatchBackfill } from '../src/services/strictMecalMatchJob.js';
import { activeOpportunityFilter } from '../src/services/opportunityLifecycle.js';

await connectDb(process.env.MONGODB_URI);

const before = {
  active: await Opportunity.countDocuments(activeOpportunityFilter()),
  byCategory: await Opportunity.aggregate([
    { $match: activeOpportunityFilter() },
    { $group: { _id: '$category', n: { $sum: 1 } } }
  ])
};
console.log('AVANT backfill (inchangé attendu)', JSON.stringify(before, null, 2));

const result = await runStrictMecalMatchBackfill();
console.log('RÉSULTAT strictMecalMatch', result);

const after = {
  active: await Opportunity.countDocuments(activeOpportunityFilter()),
  byCategory: await Opportunity.aggregate([
    { $match: activeOpportunityFilter() },
    { $group: { _id: '$category', n: { $sum: 1 } } }
  ]),
  strict: await Opportunity.aggregate([
    { $match: activeOpportunityFilter() },
    { $group: { _id: '$strictMecalMatch.status', n: { $sum: 1 } } }
  ])
};
console.log('APRÈS backfill', JSON.stringify(after, null, 2));

await Opportunity.db.close();
