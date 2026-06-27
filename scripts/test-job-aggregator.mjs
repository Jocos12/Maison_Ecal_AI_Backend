/**
 * Démonstration agrégateur multi-sources.
 * Usage: node scripts/test-job-aggregator.mjs
 */
import { searchAllSources } from '../src/services/jobSearchAggregator.js';
import { filterJobListings } from '../src/config/jobBusinessRules.js';

process.env.RELIEFWEB_APPNAME = '';

const result = await searchAllSources({
  query: 'logistique',
  role: 'logistique',
  allRdc: true,
  broadenSearch: true
});

const logistics = filterJobListings(result.offers);

console.log('=== Test agrégateur Assistant Emploi ===');
console.log('Sources:', JSON.stringify(result.sources, null, 2));
console.log('Failed:', JSON.stringify(result.failedSources, null, 2));
console.log('Alerts:', result.sourceAlerts);
console.log(`Offres brutes: ${result.offers.length}, après filtre logistique: ${logistics.length}`);
if (logistics.length > 0) {
  console.log('Exemple offre:', {
    title: logistics[0].title,
    sourceUrl: logistics[0].sourceUrl,
    source: logistics[0].source,
    verified: Boolean(logistics[0].sourceUrl)
  });
}
console.log('allSourcesFailed:', result.allSourcesFailed);
console.log('Système bloqué?', result.allSourcesFailed && logistics.length === 0 ? 'OUI' : 'NON — résultats partiels OK');
