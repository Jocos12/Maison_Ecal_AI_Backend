import '../src/loadEnv.js';
import { connectDb } from '../src/config/db.js';
import ScrapeLog from '../src/models/ScrapeLog.js';

await connectDb(process.env.MONGODB_URI);
const log = await ScrapeLog.findOne({ skippedItems: { $exists: true, $ne: [] } })
  .sort({ startedAt: -1 })
  .lean();
const items = (log?.skippedItems || []).filter((i) => i.reasonKey === 'not_mecal_service');
const tally = {};
for (const i of items) {
  const k = `${i.source || ''} | plat=${i.platform || ''} | org=${String(i.organization || '').slice(0, 30)}`;
  tally[k] = (tally[k] || 0) + 1;
}
console.log(
  Object.entries(tally)
    .sort((a, b) => b[1] - a[1])
    .map(([k, n]) => `${n}\t${k}`)
    .join('\n')
);
await ScrapeLog.db.close();
