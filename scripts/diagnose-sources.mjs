import '../src/loadEnv.js';
import mongoose from 'mongoose';
import { connectDb } from '../src/config/db.js';
import Source from '../src/models/Source.js';
import Opportunity from '../src/models/Opportunity.js';
import { analyzeOpportunity } from '../src/services/filterService.js';
import { scrapeProfilRdc } from '../src/scrapers/profilrdc.js';
import { scrapeAchatPublicRdc } from '../src/scrapers/achatpublicrdc.js';
import { scrapeArsp } from '../src/scrapers/arsp.js';
import { scrapeSigmap } from '../src/scrapers/sigmap.js';
import { scrapeUngm } from '../src/scrapers/ungm.js';
import { scrapeDevex } from '../src/scrapers/devex.js';
import { scrapeAfdbVeille } from '../src/scrapers/veille/afdbVeille.js';
import { filterUngmLogisticsVeilleItems } from '../src/config/veilleSourceFilters.js';
import { activeOpportunityFilter } from '../src/services/opportunityLifecycle.js';
import { delay, launchBrowser } from '../src/scrapers/utils.js';

function summarize(name, raw, extra = {}) {
  const reasons = {};
  const accepted = [];
  for (const row of raw) {
    const analysis = analyzeOpportunity({
      title: row.title,
      description: row.description || '',
      organization: row.organization || '',
      location: row.location || '',
      platform: row.platform || ''
    });
    if (!analysis.accept) {
      reasons[analysis.reason] = (reasons[analysis.reason] || 0) + 1;
    } else {
      accepted.push(row);
    }
  }
  return {
    source: name,
    error: extra.error || null,
    raw: raw.length,
    passMecalFilter: accepted.length,
    skipReasons: reasons,
    sampleRaw: raw.slice(0, 5).map((r) => String(r.title || '').slice(0, 160)),
    samplePass: accepted.slice(0, 5).map((r) => String(r.title || '').slice(0, 160)),
    note: extra.note || ''
  };
}

await connectDb(process.env.MONGODB_URI);

const sources = await Source.find().select('key name enabled scraperKey lastStatus').sort({ name: 1 }).lean();
const byPlatform = await Opportunity.aggregate([
  { $match: activeOpportunityFilter() },
  { $group: { _id: '$platform', n: { $sum: 1 } } }
]);
console.log(JSON.stringify({
  sources: sources.map((s) => ({ key: s.key, name: s.name, enabled: s.enabled, scraperKey: s.scraperKey, lastStatus: s.lastStatus })),
  activeByPlatform: byPlatform,
  DEVEX_DISABLED: process.env.DEVEX_DISABLED ?? '(unset, treated as disabled in runAllScrapers)'
}, null, 2));

const results = [];
async function run(label, fn, extra = {}) {
  const t0 = Date.now();
  try {
    const raw = await fn();
    const summary = summarize(label, Array.isArray(raw) ? raw : [], extra);
    summary.ms = Date.now() - t0;
    results.push(summary);
    console.log('\n===', label, '===');
    console.log(JSON.stringify(summary, null, 2));
    return Array.isArray(raw) ? raw : [];
  } catch (e) {
    const summary = summarize(label, [], { error: e.message, ...extra });
    summary.ms = Date.now() - t0;
    results.push(summary);
    console.log('\n===', label, 'ERROR ===', e.message);
    return [];
  }
}

await run('1.ProfilRDC', scrapeProfilRdc);
await run('2.AchatPublicRDC', scrapeAchatPublicRdc);
await run('3.ARSP', scrapeArsp);
const ungm = await run('5.UNGM', scrapeUngm);
const ungmLog = filterUngmLogisticsVeilleItems(ungm);
results.push(summarize('5b.UNGM logistics-prefilter', ungmLog, { note: 'filterUngmLogisticsVeilleItems on same UNGM raw' }));
console.log('\n=== 5b.UNGM logistics-prefilter ===');
console.log(JSON.stringify(results[results.length - 1], null, 2));

await run('4.SIGMAP', scrapeSigmap);
await run('6.DevEx', scrapeDevex, { note: 'scraper implemented (Puppeteer); often paywall' });
await run('8.AfDBVeille-filtered', scrapeAfdbVeille);

try {
  const browser = await launchBrowser();
  const page = await browser.newPage();
  await page.goto('https://www.afdb.org/en/projects-and-operations/procurement', {
    waitUntil: 'domcontentloaded',
    timeout: 90000
  });
  await delay(2500);
  const afdbRaw = await page.evaluate(() =>
    [...document.querySelectorAll('a[href*="/documents/"]')]
      .map((a) => ({ title: (a.textContent || '').replace(/\s+/g, ' ').trim(), href: a.href }))
      .filter((x) => x.title.length > 18)
      .slice(0, 12)
  );
  await browser.close();
  results.push(
    summarize(
      '8b.AfDB page raw links (unfiltered)',
      afdbRaw.map((r) => ({
        title: r.title,
        description: r.title,
        platform: 'AfDB',
        location: '',
        organization: 'AfDB',
        sourceUrl: r.href
      })),
      { note: 'titles from procurement page before RDC filter' }
    )
  );
  console.log('\n=== 8b.AfDB raw ===');
  console.log(JSON.stringify(results[results.length - 1], null, 2));
} catch (e) {
  console.log('AfDB raw dump failed', e.message);
}

console.log('\n=== TABLE ===');
console.log(
  results
    .map((r) => `${r.source}\traw=${r.raw}\tpass=${r.passMecalFilter}\terr=${r.error || '-'}`)
    .join('\n')
);

await mongoose.disconnect();
