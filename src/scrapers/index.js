import { analyzeOpportunity } from '../services/filterService.js';
import { upsertOpportunity } from '../services/deduplicationService.js';
import { sendWhatsAppNewOpportunity } from '../services/notificationService.js';
import { analyzeOpportunityForMecal, scoreRelevanceWithAI } from '../services/aiClassifierService.js';
import User from '../models/User.js';
import { scrapeReliefWeb } from './reliefweb.js';
import { scrapeUngm } from './ungm.js';
import { scrapeDevex } from './devex.js';
import { scrapeProfilRdc } from './profilrdc.js';
import { scrapeAchatPublicRdc } from './achatpublicrdc.js';
import logger from '../utils/logger.js';
import Source from '../models/Source.js';
import ScrapeLog from '../models/ScrapeLog.js';
import { ensureDefaultSources, getActiveScraperKeys } from '../services/sourceService.js';

function isUrgent(deadline) {
  if (!deadline) return false;
  const d = new Date(deadline);
  const now = new Date();
  const diff = (d - now) / (1000 * 60 * 60 * 24);
  return diff >= 0 && diff <= 7;
}

async function shouldNotifyImmediate() {
  const u = await User.findOne({ alertsEnabled: true, alertFrequency: 'immediate' });
  return Boolean(u);
}

/**
 * Process raw scraper rows: filter → optional AI → save → WhatsApp if new & immediate
 */
export async function ingestRawItems(rawItems) {
  let saved = 0;
  let skipped = 0;
  const createdIds = [];

  const users = await User.find({ keywords: { $exists: true, $ne: [] } }).select('keywords').lean();
  const extraInclude = [...new Set(users.flatMap((u) => u.keywords || []).filter(Boolean))];

  for (const row of rawItems) {
    if (!row.sourceUrl || !row.title) {
      skipped++;
      continue;
    }
    const analysis = analyzeOpportunity(
      {
        title: row.title,
        description: row.description || '',
        organization: row.organization || ''
      },
      { extraInclude }
    );
    if (!analysis.accept) {
      skipped++;
      continue;
    }

    let aiScore = null;
    let aiAnalysis = null;
    if (process.env.ANTHROPIC_API_KEY || process.env.GROQ_API_KEY || process.env.GEMINI_API_KEY) {
      aiAnalysis = await analyzeOpportunityForMecal({
        title: row.title,
        description: row.description || '',
        organization: row.organization || '',
        ville: analysis.ville
      });
      if (aiAnalysis.est_emploi || !aiAnalysis.est_service) {
        skipped++;
        continue;
      }
      aiScore = Math.min(1, Math.max(0, Number(aiAnalysis.score || 0) / 100));
      if (aiScore < 0.25) {
        skipped++;
        continue;
      }
    } else if (process.env.OPENAI_API_KEY) {
      aiScore = await scoreRelevanceWithAI({
        title: row.title,
        description: row.description || '',
        organization: row.organization || ''
      });
      if (aiScore != null && aiScore < 0.25) {
        skipped++;
        continue;
      }
    }

    const payload = {
      title: row.title,
      description: row.description || '',
      organization: row.organization || '',
      platform: row.platform,
      category: analysis.category,
      location: row.location || '',
      ville: analysis.ville || 'Non précisé',
      deadline: row.deadline || undefined,
      postedDate: row.postedDate || undefined,
      sourceUrl: row.sourceUrl,
      isNew: true,
      isUrgent: isUrgent(row.deadline),
      rawKeywords: analysis.rawKeywords,
      ...(aiScore != null ? { aiRelevanceScore: aiScore } : {}),
      ...(aiAnalysis ? { aiAnalysis } : {})
    };

    try {
      const { created, doc } = await upsertOpportunity(payload);
      if (created) {
        saved++;
        createdIds.push(doc._id);
        const notify = await shouldNotifyImmediate();
        if (notify) {
          await sendWhatsAppNewOpportunity(doc).catch((e) => logger.warn(e.message));
        }
      }
    } catch (e) {
      if (e.code === 11000) skipped++;
      else logger.warn(`ingest: ${e.message}`);
    }
  }

  return { saved, skipped, createdIds };
}

const SCRAPERS = {
  ReliefWeb: scrapeReliefWeb,
  UNGM: scrapeUngm,
  DevEx: scrapeDevex,
  ProfilRDC: scrapeProfilRdc,
  AchatPublicRDC: scrapeAchatPublicRdc
};

export async function runAllScrapers({ triggeredBy = 'manual' } = {}) {
  await ensureDefaultSources();
  const log = await ScrapeLog.create({ status: 'running', triggeredBy });
  const activeScraperKeys = await getActiveScraperKeys();
  const results = Object.fromEntries(Object.keys(SCRAPERS).map((key) => [key, []]));

  try {
    for (const [key, scraper] of Object.entries(SCRAPERS)) {
      if (!activeScraperKeys.has(key)) continue;
      try {
        results[key] = await scraper();
        await Source.updateOne(
          { scraperKey: key },
          { $set: { lastScrapedAt: new Date(), lastStatus: 'success' } }
        );
      } catch (e) {
        await Source.updateOne({ scraperKey: key }, { $set: { lastStatus: 'error' } });
        logger.warn(`Scraper ${key}: ${e.message}`);
      }
    }

    const flat = Object.values(results).flat();
    const summary = await ingestRawItems(flat);
    const payload = {
      ...summary,
      totalRaw: flat.length,
      byPlatform: Object.fromEntries(Object.entries(results).map(([k, v]) => [k, v.length]))
    };

    await ScrapeLog.findByIdAndUpdate(log._id, {
      $set: { ...payload, status: 'success', finishedAt: new Date() }
    });
    logger.info(`Scrape done: ${flat.length} raw -> saved ${summary.saved}, skipped ${summary.skipped}`);
    return payload;
  } catch (e) {
    await ScrapeLog.findByIdAndUpdate(log._id, {
      $set: { status: 'error', finishedAt: new Date(), message: e.message }
    });
    throw e;
  }
}

export { scrapeReliefWeb, scrapeUngm, scrapeDevex, scrapeProfilRdc, scrapeAchatPublicRdc };
