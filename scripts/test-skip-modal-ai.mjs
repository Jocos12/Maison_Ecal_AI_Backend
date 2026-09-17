/**
 * Test skip-detail reasons + AI buttons on 3 real skipped offers.
 */
import '../src/loadEnv.js';
import { connectDb } from '../src/config/db.js';
import ScrapeLog from '../src/models/ScrapeLog.js';
import { enrichSkippedOffer, getSkipCategoryAdvice, getSkipCategoryInsights } from '../src/services/agentSkipAdviceService.js';

await connectDb(process.env.MONGODB_URI);

const log = await ScrapeLog.findOne({ 'skippedItems.0': { $exists: true } }).sort({ startedAt: -1 }).lean();
if (!log) {
  console.log('NO_SKIPPED_LOG');
  process.exit(0);
}

const key = 'not_mecal_service';
const raw = (log.skippedItems || []).filter((i) => i.reasonKey === key);
const offers = raw.map(enrichSkippedOffer);
const sample = offers.slice(0, 3);

console.log(JSON.stringify({
  logId: String(log._id),
  skippedTotal: log.skipped,
  notMecal: log.skipReasons?.not_mecal_service || offers.length,
  sample: sample.map((o) => ({
    title: o.title?.slice(0, 90),
    source: o.source,
    rejectReason: o.rejectReason,
    rejectCode: o.rejectCode,
    scoreLabel: o.score == null ? 'Hors périmètre — non noté' : o.score,
    url: o.url,
    urlOk: Boolean(o.url && /^https?:\/\//i.test(o.url))
  }))
}, null, 2));

for (const [i, offer] of sample.entries()) {
  const why = await getSkipCategoryAdvice({
    categoryLabel: 'Hors services M-ECAL',
    count: offers.length,
    logDate: String(log.startedAt),
    offers: [offer],
    userMessage: `Pourquoi cette offre a-t-elle été rejetée ?\nTitre: ${offer.title}\nRaison: ${offer.rejectReason}\nDesc: ${(offer.description || '').slice(0, 400)}`
  });
  const apply = await getSkipCategoryAdvice({
    categoryLabel: 'Hors services M-ECAL',
    count: offers.length,
    logDate: String(log.startedAt),
    offers: [offer],
    userMessage: `Puis-je postuler ? Réponds OUI/NON/PEUT-ÊTRE. Titre: ${offer.title}. Raison: ${offer.rejectReason}`
  });
  console.log(`\n=== OFFRE ${i + 1}: ${offer.title.slice(0, 70)} ===`);
  console.log('POURQUOI:', why.reply.slice(0, 500));
  console.log('POSTULER:', apply.reply.slice(0, 500));
}

const insights = await getSkipCategoryInsights({
  categoryLabel: 'Hors services M-ECAL',
  count: offers.length,
  logDate: String(log.startedAt),
  offers
});
console.log('\n=== INSIGHTS ===\n', insights.reply);

await ScrapeLog.db.close();
