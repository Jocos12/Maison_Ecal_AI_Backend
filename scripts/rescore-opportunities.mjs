import '../src/loadEnv.js';
import { connectDb } from '../src/config/db.js';
import { rescoreStoredOpportunities } from '../src/services/opportunityRescoreService.js';
import Opportunity from '../src/models/Opportunity.js';
import { activeOpportunityFilter } from '../src/services/opportunityLifecycle.js';

const useAI = process.argv.includes('--ai');
const dryRun = process.argv.includes('--dry-run');
const includeArchived = process.argv.includes('--all');
const onlyFlagged = process.argv.includes('--flagged');

function resolveMongoUri() {
  const fromEnv = process.env.MONGODB_URI?.trim();
  if (fromEnv) return fromEnv;
  return 'mongodb://127.0.0.1:27017/mecal_monitor';
}

async function main() {
  await connectDb(resolveMongoUri());
  const titleIncludes = onlyFlagged
    ? ['Food Security Monitor', 'Ebola response', 'Logistics Coordinator']
    : [];
  console.log('[rescore] Démarrage...', { useAI, dryRun, includeArchived, titleIncludes });
  const summary = await rescoreStoredOpportunities({ useAI, dryRun, includeArchived, titleIncludes });
  console.log('[rescore] Terminé:', JSON.stringify(summary, null, 2));

  const recommended = await Opportunity.find(activeOpportunityFilter({ isRecommended: true }))
    .sort({ aiRelevanceScore: -1, createdAt: -1 })
    .select('title organization platform aiRelevanceScore aiScoringProvider')
    .lean();
  console.log('[rescore] Recommandées restantes:', recommended.length);
  for (const o of recommended) {
    console.log(
      `  - ${Math.round((o.aiRelevanceScore || 0) * 100)}% [${o.aiScoringProvider || '?'}] ${o.title} (${o.organization || o.platform || ''})`
    );
  }
  process.exit(0);
}

main().catch((error) => {
  console.error('[rescore] Erreur:', error.message);
  process.exit(1);
});
