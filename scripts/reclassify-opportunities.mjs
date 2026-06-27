import '../src/loadEnv.js';
import { connectDb } from '../src/config/db.js';
import { reclassifyOpportunities } from '../src/services/opportunityReclassifyService.js';

const useAI = process.argv.includes('--ai');
const dryRun = process.argv.includes('--dry-run');
const includeArchived = process.argv.includes('--all');

function resolveMongoUri() {
  const fromEnv = process.env.MONGODB_URI?.trim();
  if (fromEnv) return fromEnv;
  return 'mongodb://127.0.0.1:27017/mecal_monitor';
}

async function main() {
  await connectDb(resolveMongoUri());
  console.log('[reclassify] Démarrage...', { useAI, dryRun, includeArchived });
  const summary = await reclassifyOpportunities({ useAI, dryRun, includeArchived });
  console.log('[reclassify] Terminé:', JSON.stringify(summary, null, 2));
  process.exit(0);
}

main().catch((error) => {
  console.error('[reclassify] Erreur:', error.message);
  process.exit(1);
});
