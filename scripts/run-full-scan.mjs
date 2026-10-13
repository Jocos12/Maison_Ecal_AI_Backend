import '../src/loadEnv.js';
import mongoose from 'mongoose';
import { connectDb } from '../src/config/db.js';
import { runAllScrapers } from '../src/scrapers/index.js';
import Opportunity from '../src/models/Opportunity.js';
import { activeOpportunityFilter } from '../src/services/opportunityLifecycle.js';

const uri = process.env.MONGODB_URI;
await connectDb(uri);

const before = await Opportunity.countDocuments(activeOpportunityFilter());
const byPlatformBefore = await Opportunity.aggregate([
  { $match: activeOpportunityFilter() },
  { $group: { _id: '$platform', n: { $sum: 1 } } }
]);

const result = await runAllScrapers({ triggeredBy: 'full-scan-verification' });

const after = await Opportunity.countDocuments(activeOpportunityFilter());
const byPlatformAfter = await Opportunity.aggregate([
  { $match: activeOpportunityFilter() },
  { $group: { _id: '$platform', n: { $sum: 1 } } }
]);

const { createdIds, skippedItems, ...rest } = result;
console.log(
  JSON.stringify(
    {
      activeBefore: before,
      activeAfter: after,
      byPlatformBefore,
      byPlatformAfter,
      sourcesScanned: rest.sourcesScanned,
      byPlatformRaw: rest.byPlatform,
      totalRaw: rest.totalRaw,
      saved: rest.saved,
      skipped: rest.skipped,
      archivedExpired: rest.archivedExpired,
      archivedStale: rest.archivedStale,
      archivedTotal: rest.archivedTotal,
      aiProvider: rest.aiProvider,
      aiProviders: rest.aiProviders,
      scoredCount: rest.scoredCount,
      recommendedCount: rest.recommendedCount,
      skipReasons: rest.skipReasons,
      errors: rest.errors,
      message: rest.message
    },
    null,
    2
  )
);

await mongoose.disconnect();
