import { analyzeOpportunity } from '../services/filterService.js';
import { upsertOpportunity } from '../services/deduplicationService.js';
import { sendWhatsAppNewOpportunity } from '../services/notificationService.js';
import { analyzeOpportunityForMecal, scoreRelevanceWithAI } from '../services/aiClassifierService.js';
import { mapAiCategoryToSlug } from '../config/businessRules.js';
import User from '../models/User.js';
import { scrapeReliefWeb } from './reliefweb.js';
import { scrapeUngm } from './ungm.js';
import { scrapeDevex } from './devex.js';
import { scrapeProfilRdc } from './profilrdc.js';
import { scrapeAchatPublicRdc } from './achatpublicrdc.js';
import { scrapeDevexVeille } from './veille/devexVeille.js';
import { scrapeUngmLogisticsVeille } from './veille/ungmLogisticsVeille.js';
import { scrapeAfdbVeille } from './veille/afdbVeille.js';
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
  const skipReasons = {};
  const skippedItems = [];
  const MAX_SKIPPED_ITEMS = 400;
  const hasAi = Boolean(process.env.ANTHROPIC_API_KEY || process.env.GROQ_API_KEY || process.env.GEMINI_API_KEY);

  const trackSkip = (reason, row = {}, extra = {}) => {
    skipped++;
    const key = reason || 'unknown';
    skipReasons[key] = (skipReasons[key] || 0) + 1;
    if (skippedItems.length >= MAX_SKIPPED_ITEMS) return;

    let score = extra.score;
    if (score != null && score <= 1) score = Math.round(score * 100);
    else if (score != null) score = Math.round(score);

    skippedItems.push({
      reasonKey: key,
      title: String(row.title || 'Sans titre').slice(0, 300),
      description: String(row.description || '').slice(0, 800),
      source: row.platform || row.organization || 'Inconnue',
      organization: row.organization || '',
      platform: row.platform || '',
      date: row.postedDate ? new Date(row.postedDate) : new Date(),
      url: row.sourceUrl || '',
      score: score ?? null
    });
  };

  const users = await User.find({ keywords: { $exists: true, $ne: [] } }).select('keywords').lean();
  const extraInclude = [...new Set(users.flatMap((u) => u.keywords || []).filter(Boolean))];

  for (const row of rawItems) {
    if (!row.sourceUrl || !row.title) {
      trackSkip('missing_fields', row);
      continue;
    }
    const analysis = analyzeOpportunity(
      {
        title: row.title,
        description: row.description || '',
        organization: row.organization || '',
        location: row.location || '',
        platform: row.platform || ''
      },
      { extraInclude }
    );
    if (!analysis.accept) {
      trackSkip(analysis.reason, row);
      continue;
    }

    let aiScore = null;
    let aiAnalysis = null;
    let category = analysis.category;
    let locationStatus = analysis.locationStatus || 'a_verifier';
    let ville = analysis.ville || 'Non précisé';
    const needsAiReview = analysis.needsAiReview && !category;

    if (needsAiReview && !hasAi) {
      trackSkip('needs_ai_no_keys', row);
      continue;
    }

    if (hasAi) {
      aiAnalysis = await analyzeOpportunityForMecal({
        title: row.title,
        description: row.description || '',
        organization: row.organization || '',
        ville,
        location: row.location || ''
      });
      if (
        aiAnalysis.est_emploi ||
        !aiAnalysis.est_service ||
        aiAnalysis.categorie === 'non pertinent' ||
        aiAnalysis.pays_confirme_rdc !== 'true'
      ) {
        trackSkip(
          aiAnalysis.pays_confirme_rdc === 'false' || aiAnalysis.pays_confirme_rdc === false
            ? 'hors_rdc'
            : 'ai_rejected',
          row,
          { score: Number(aiAnalysis.score || 0) }
        );
        continue;
      }
      const mappedCategory = mapAiCategoryToSlug(aiAnalysis.categorie);
      if (!mappedCategory) {
        trackSkip('ai_no_category', row, { score: Number(aiAnalysis.score || 0) });
        continue;
      }
      category = mappedCategory;
      locationStatus = 'rdc_confirme';
      const allowedVilles = ['Bukavu', 'Goma', 'Kinshasa', 'Kalemie', 'Lubumbashi', 'RDC', 'Non précisé'];
      if (allowedVilles.includes(aiAnalysis.ville_confirmee) && aiAnalysis.ville_confirmee !== 'Kinshasa') {
        ville = aiAnalysis.ville_confirmee;
      }
      aiScore = Math.min(1, Math.max(0, Number(aiAnalysis.score || 0) / 100));
      const minScore = needsAiReview ? 0.35 : 0.4;
      if (aiScore < minScore) {
        trackSkip('ai_low_score', row, { score: aiScore });
        continue;
      }
    } else if (!category) {
      trackSkip('no_category', row);
      continue;
    } else if (process.env.OPENAI_API_KEY) {
      aiScore = await scoreRelevanceWithAI({
        title: row.title,
        description: row.description || '',
        organization: row.organization || ''
      });
      if (aiScore != null && aiScore < 0.25) {
        trackSkip('ai_low_score', row, { score: aiScore });
        continue;
      }
    }

    if (locationStatus !== 'rdc_confirme') {
      trackSkip('hors_rdc', row);
      continue;
    }

    const payload = {
      title: row.title,
      description: row.description || '',
      organization: row.organization || '',
      platform: row.platform,
      category,
      location: row.location || '',
      locationStatus,
      ville,
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
      if (e.code === 11000) trackSkip('duplicate', row);
      else logger.warn(`ingest: ${e.message}`);
    }
  }

  if (skipped > 0) {
    logger.info(`Ingest filtres: ${JSON.stringify(skipReasons)}`);
  }

  return { saved, skipped, createdIds, skipReasons, skippedItems };
}

const SCRAPERS = {
  ReliefWeb: scrapeReliefWeb,
  UNGM: scrapeUngm,
  DevEx: scrapeDevex,
  ProfilRDC: scrapeProfilRdc,
  AchatPublicRDC: scrapeAchatPublicRdc,
  DevExVeille: scrapeDevexVeille,
  UNGMVeille: scrapeUngmLogisticsVeille,
  AfDBVeille: scrapeAfdbVeille
};

export async function runAllScrapers({ triggeredBy = 'manual' } = {}) {
  await ensureDefaultSources();
  const log = await ScrapeLog.create({ status: 'running', triggeredBy });
  const activeScraperKeys = await getActiveScraperKeys();
  const results = Object.fromEntries(Object.keys(SCRAPERS).map((key) => [key, []]));

  try {
    for (const [key, scraper] of Object.entries(SCRAPERS)) {
      if (!activeScraperKeys.has(key)) continue;
      if (key === 'DevEx' && process.env.DEVEX_DISABLED !== 'false') {
        logger.info('Scraper DevEx: ignoré (ajoutez DEVEX_DISABLED=false pour activer)');
        continue;
      }
      if (key === 'DevExVeille' && process.env.DEVEX_VEILLE_DISABLED === 'true') {
        logger.info('Scraper DevExVeille: désactivé (DEVEX_VEILLE_DISABLED=true)');
        continue;
      }
      try {
        results[key] = await scraper();
        logger.info(`Scraper ${key}: ${results[key].length} raw`);
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
    logger.info(`Scrape done: ${flat.length} raw -> saved ${summary.saved}, skipped ${summary.skipped}${summary.skipReasons ? ` (${JSON.stringify(summary.skipReasons)})` : ''}`);
    return payload;
  } catch (e) {
    await ScrapeLog.findByIdAndUpdate(log._id, {
      $set: { status: 'error', finishedAt: new Date(), message: e.message }
    });
    throw e;
  }
}

export { scrapeReliefWeb, scrapeUngm, scrapeDevex, scrapeProfilRdc, scrapeAchatPublicRdc, scrapeDevexVeille, scrapeUngmLogisticsVeille, scrapeAfdbVeille };
