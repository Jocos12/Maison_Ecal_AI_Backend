/**
 * One-shot: close ScrapeLog entries stuck in status "running".
 * In-memory lock scrapeInFlight cannot be cleared from this script (process-local).
 *
 * Usage (from backend/): node scripts/fix-stuck-running-scrapes.mjs
 */
import '../src/loadEnv.js';
import mongoose from 'mongoose';
import { connectDb } from '../src/config/db.js';
import ScrapeLog from '../src/models/ScrapeLog.js';

const uri = process.env.MONGODB_URI;
await connectDb(uri);

const MESSAGE = 'Scan interrompu - corrigé manuellement suite à un bug';
const stuck = await ScrapeLog.find({ status: 'running' })
  .select('_id status startedAt triggeredBy totalRaw saved message')
  .sort({ startedAt: 1 })
  .lean();

console.log(
  JSON.stringify(
    {
      found: stuck.length,
      entries: stuck.map((log) => ({
        id: String(log._id),
        startedAt: log.startedAt,
        triggeredBy: log.triggeredBy,
        totalRaw: log.totalRaw,
        saved: log.saved
      }))
    },
    null,
    2
  )
);

if (stuck.length === 0) {
  console.log('Aucun scan bloqué en running. Rien à mettre à jour.');
  await mongoose.disconnect();
  process.exit(0);
}

const result = await ScrapeLog.updateMany(
  { status: 'running' },
  {
    $set: {
      status: 'error',
      finishedAt: new Date(),
      message: MESSAGE,
      errors: [{ source: 'manual-fix', message: MESSAGE }]
    }
  }
);

console.log(
  JSON.stringify(
    {
      matched: result.matchedCount,
      modified: result.modifiedCount,
      message: MESSAGE
    },
    null,
    2
  )
);

await mongoose.disconnect();
