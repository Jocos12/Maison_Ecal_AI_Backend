/**
 * Dry-run only: strict M-ECAL classifier on a sample. Does not write to Mongo.
 */
import '../src/loadEnv.js';
import { connectDb } from '../src/config/db.js';
import Opportunity from '../src/models/Opportunity.js';
import { classifyStrictMecalMatch } from '../src/services/strictMecalMatchService.js';
import { activeOpportunityFilter } from '../src/services/opportunityLifecycle.js';

await connectDb(process.env.MONGODB_URI);

const preferred = [
  /KCC1811170|camping/i,
  /parc de camions/i,
  /audit annuel des marchés/i,
  /Coordinator, Logistics/i,
  /VBG-EAS/i,
  /Food Security Monitor/i,
  /financement du secteur agricole/i,
  /Language Technology/i,
  /agents de voyage/i,
  /développeurs individuels/i
];

const active = await Opportunity.find(activeOpportunityFilter())
  .select('title description organization platform location category aiRelevanceScore')
  .lean();

const sample = [];
for (const re of preferred) {
  const hit = active.find((o) => re.test(o.title) && !sample.some((s) => String(s._id) === String(o._id)));
  if (hit) sample.push(hit);
}
for (const o of active) {
  if (sample.length >= 10) break;
  if (!sample.some((s) => String(s._id) === String(o._id))) sample.push(o);
}

console.log(`DRY-RUN strictMecalMatch — ${sample.length} offres, aucune écriture en base\n`);

for (const o of sample) {
  const result = await classifyStrictMecalMatch({
    title: o.title,
    description: o.description,
    organization: o.organization,
    platform: o.platform,
    location: o.location
  });
  console.log(
    JSON.stringify(
      {
        title: o.title.slice(0, 120),
        categoryActuelleInchangee: o.category,
        strictStatus: result.statusLabel,
        strictCategory: result.categoryLabel,
        justification: result.justification,
        provider: result.provider
      },
      null,
      2
    )
  );
}

await Opportunity.db.close();
