import '../src/loadEnv.js';
import mongoose from 'mongoose';
import { alertIfScrapeOverdueOrFailed } from '../src/services/scrapeWatchdog.js';

await mongoose.connect(process.env.MONGODB_URI);
const watch = await alertIfScrapeOverdueOrFailed({
  simulateAgeMs: 2.5 * 60 * 60 * 1000,
  forceCritical: true
});
console.log(
  JSON.stringify(
    {
      critical: watch.critical,
      overdue: watch.overdue,
      simulatedMinutes: 150,
      emailSent: watch.criticalEmail?.sent ?? 0,
      recipientCount: watch.criticalEmail?.recipients?.length ?? 0
    },
    null,
    2
  )
);
await mongoose.disconnect();
