/**
 * Diagnostic + archivage immédiat de l'offre Port sec Kalamba Mbuji.
 */
import '../src/loadEnv.js';
import mongoose from 'mongoose';
import * as cheerio from 'cheerio';
import { connectDb } from '../src/config/db.js';
import Opportunity from '../src/models/Opportunity.js';
import { fetchHtml } from '../src/scrapers/utils.js';
import { STALE_NO_DEADLINE_DAYS } from '../src/config/constants.js';

const TITLE_RE = /kalamba\s*mbuji/i;

function findPdfLinks(html, pageUrl) {
  const $ = cheerio.load(html);
  const links = [];
  $('a[href]').each((_, el) => {
    const href = $(el).attr('href') || '';
    if (!/\.pdf(\?|#|$)/i.test(href) && !/wp-content\/uploads/i.test(href)) return;
    if (!/\.pdf/i.test(href) && !/application\/pdf/i.test($(el).attr('type') || '')) return;
    try {
      links.push(new URL(href, pageUrl).href);
    } catch {
      /* skip */
    }
  });
  return [...new Set(links)];
}

await connectDb(process.env.MONGODB_URI);

const offer = await Opportunity.findOne({
  $or: [{ title: TITLE_RE }, { sourceUrl: /kalamba-mbuji/i }]
}).lean();

if (!offer) {
  console.log(JSON.stringify({ error: 'offre introuvable' }, null, 2));
  await mongoose.disconnect();
  process.exit(1);
}

const staleDays = STALE_NO_DEADLINE_DAYS;
const cutoff = new Date(Date.now() - staleDays * 24 * 60 * 60 * 1000);
const firstSeen = offer.firstSeenAt || offer.createdAt;
const posted = offer.postedDate;
const ageRef = posted || firstSeen;
const wouldStale =
  !offer.deadline && ageRef && new Date(ageRef) < cutoff;

let html = '';
let pdfLinks = [];
let htmlHasDeadlineHint = false;
try {
  html = await fetchHtml(offer.sourceUrl);
  pdfLinks = findPdfLinks(html, offer.sourceUrl);
  htmlHasDeadlineHint = /date\s*(de\s*)?(cl[oô]ture|limite)|au plus tard|deadline/i.test(
    String(html).replace(/<script[\s\S]*?<\/script>/gi, ' ')
  );
} catch (e) {
  console.log('fetch html failed', e.message);
}

let pdfProbe = [];
for (const url of pdfLinks.slice(0, 4)) {
  try {
    const axios = (await import('axios')).default;
    const res = await axios.get(url, {
      responseType: 'arraybuffer',
      timeout: 45000,
      headers: { 'User-Agent': process.env.USER_AGENT || 'M-ECAL-Bot/1.0' },
      maxRedirects: 5
    });
    const buffer = Buffer.from(res.data);
    const mod = await import('pdf-parse');
    const pdfParse = mod.default || mod;
    const parsed = await pdfParse(buffer);
    const text = String(parsed.text || '').replace(/\s+/g, ' ').trim();
    const snippetMatch = text.match(/au plus tard[^.]{0,80}|28\s+ao[uû]t\s+2026[^.]{0,40}/i);
    pdfProbe.push({
      url,
      bytes: buffer.length,
      pages: parsed.numpages,
      textChars: text.length,
      extractable: text.length >= 40,
      has28Aout: /28\s+ao[uû]t\s+2026/i.test(text),
      snippet: snippetMatch ? snippetMatch[0] : text.slice(0, 220)
    });
  } catch (e) {
    pdfProbe.push({ url, error: e.message });
  }
}

const archive = await Opportunity.updateOne(
  { _id: offer._id },
  {
    $set: {
      isArchived: true,
      isNew: false,
      isRecommended: false,
      deadlineUnspecified: false,
      deadline: new Date('2026-08-28T13:00:00.000Z'),
      expiredReason: 'deadline_passed'
    }
  }
);

const stillActive = await Opportunity.findById(offer._id).select('isArchived deadline expiredReason isRecommended').lean();

console.log(
  JSON.stringify(
    {
      found: {
        id: String(offer._id),
        title: offer.title,
        platform: offer.platform,
        sourceUrl: offer.sourceUrl,
        deadline: offer.deadline,
        deadlineUnspecified: offer.deadlineUnspecified,
        postedDate: offer.postedDate,
        firstSeenAt: offer.firstSeenAt,
        createdAt: offer.createdAt,
        isArchived: offer.isArchived,
        isRecommended: offer.isRecommended,
        score: offer.aiAnalysis?.score ?? offer.aiRelevanceScore
      },
      staleRule: {
        days: staleDays,
        cutoff: cutoff.toISOString(),
        ageRef,
        wouldStaleBeforeArchive: wouldStale,
        reason: wouldStale
          ? 'aurait dû être archivée stale'
          : 'firstSeen/posted trop récent (< 45 j) donc stale_no_deadline ne s’applique pas'
      },
      htmlHasDeadlineHint,
      pdfLinks,
      pdfProbe,
      archiveModified: archive.modifiedCount,
      afterArchive: stillActive
    },
    null,
    2
  )
);

await mongoose.disconnect();
process.exit(0);
