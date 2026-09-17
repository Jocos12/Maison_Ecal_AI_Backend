import '../src/loadEnv.js';
import mongoose from 'mongoose';
import { connectDb } from '../src/config/db.js';
import { runAllScrapers } from '../src/scrapers/index.js';
import { ensureDefaultSources } from '../src/services/sourceService.js';
import Opportunity from '../src/models/Opportunity.js';
import { activeOpportunityFilter } from '../src/services/opportunityLifecycle.js';

await connectDb(process.env.MONGODB_URI);
await ensureDefaultSources();
const payload = await runAllScrapers({ triggeredBy: 'source-diversity-fix' });
const active = await Opportunity.aggregate([
  { $match: activeOpportunityFilter() },
  { $group: { _id: '$platform', n: { $sum: 1 } } },
  { $sort: { n: -1 } }
]);
console.log(
  JSON.stringify(
    {
      totalRaw: payload.totalRaw,
      saved: payload.saved,
      skipped: payload.skipped,
      scoredCount: payload.scoredCount,
      recommendedCount: payload.recommendedCount,
      byPlatformRaw: payload.byPlatform,
      retainedByPlatform: payload.retainedByPlatform,
      skipReasons: payload.skipReasons,
      errors: payload.errors,
      activeByPlatform: active
    },
    null,
    2
  )
);
await mongoose.disconnect();
process.exit(0);
