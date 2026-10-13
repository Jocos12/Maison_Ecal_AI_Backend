import Opportunity from '../models/Opportunity.js';
import { analyzeOpportunity } from './filterService.js';
import {
  classifyMecalCategory,
  resolveVille
} from '../config/businessRules.js';
import { HIGH_RELEVANCE_THRESHOLD } from '../config/constants.js';
import {
  keywordFallbackGate,
  keywordMatchScore,
  scoreOpportunityForMecal
} from './mecalMatchService.js';
import { dismissMatchAlertsForOpportunity } from './matchAlertService.js';
import logger from '../utils/logger.js';

function rowFromOpp(opp) {
  return {
    title: opp.title || '',
    description: opp.description || '',
    organization: opp.organization || '',
    location: opp.location || '',
    platform: opp.platform || '',
    category: opp.category || ''
  };
}

async function demoteAlerts(oppId) {
  await dismissMatchAlertsForOpportunity(oppId);
}

/**
 * Recalcule filtres + score (fallback mots-clés, ou IA si useAI) sur les offres en base.
 * Met à jour isRecommended et retire les alertes dashboard si l’offre n’est plus pertinente.
 */
export async function rescoreStoredOpportunities({
  useAI = false,
  dryRun = false,
  includeArchived = false,
  titleIncludes = []
} = {}) {
  const query = includeArchived ? {} : { isArchived: false };
  if (titleIncludes.length) {
    query.$or = titleIncludes.map((q) => ({ title: { $regex: q, $options: 'i' } }));
  }

  const opportunities = await Opportunity.find(query).sort({ createdAt: -1 });
  const summary = {
    total: opportunities.length,
    updated: 0,
    archived: 0,
    demoted: 0,
    stillRecommended: 0,
    recommendedNow: 0,
    jobsRejected: 0,
    horsRdc: 0,
    nonLogistics: 0,
    dryRun,
    useAI,
    examples: []
  };

  for (const opp of opportunities) {
    const row = rowFromOpp(opp);
    const analysis = analyzeOpportunity(row);
    const gate = keywordFallbackGate(row, analysis);
    const keywordScore = keywordMatchScore(row, analysis);

    let match = {
      score: keywordScore,
      recommended: gate.ok && keywordScore >= HIGH_RELEVANCE_THRESHOLD,
      provider: 'keywords',
      justification: gate.ok
        ? 'Score de secours par mots-clés (profil M-ECAL).'
        : `Exclu au rescoring (${gate.reason}).`
    };

    if (useAI && gate.ok && analysis.accept) {
      match = await scoreOpportunityForMecal(row, analysis);
    }

    const filterReject = !analysis.accept;
    const shouldArchive =
      filterReject &&
      ['job_posting', 'hors_rdc', 'not_mecal_service', 'non_logistics', 'not_a_tender'].includes(analysis.reason);

    if (analysis.reason === 'job_posting') summary.jobsRejected++;
    if (analysis.reason === 'hors_rdc' || gate.reason === 'hors_rdc') summary.horsRdc++;
    if (analysis.reason === 'non_logistics' || gate.reason === 'non_logistics') summary.nonLogistics++;

    const wasRecommended = Boolean(opp.isRecommended);
    const nextRecommended = !filterReject && !shouldArchive && match.recommended === true;
    const category = analysis.category || classifyMecalCategory(`${row.title} ${row.description}`) || opp.category;
    const ville = analysis.ville || resolveVille(row) || opp.ville;
    const locationStatus = analysis.locationStatus || opp.locationStatus || 'a_verifier';

    if (wasRecommended && !nextRecommended) {
      summary.demoted++;
      if (summary.examples.length < 20) {
        summary.examples.push({ title: opp.title, reason: gate.reason || analysis.reason, score: match.score });
      }
    }
    if (nextRecommended) summary.recommendedNow++;
    if (wasRecommended && nextRecommended) summary.stillRecommended++;

    if (dryRun) continue;

    const patch = {
      isRecommended: nextRecommended,
      aiRelevanceScore: match.score,
      aiScoringProvider: match.provider,
      category,
      ville,
      locationStatus,
      aiAnalysis: {
        ...(opp.aiAnalysis?.toObject?.() || opp.aiAnalysis || {}),
        est_emploi: analysis.type === 'offre_emploi',
        est_service: analysis.accept && analysis.type !== 'offre_emploi',
        type: analysis.type || 'service',
        score: Math.round((match.score || 0) * 100),
        justification: match.justification,
        recommandation: nextRecommended ? 'POSTULER' : 'EVALUER',
        raison: match.justification,
        pays_confirme_rdc:
          locationStatus === 'rdc_confirme' ? 'true' : locationStatus === 'hors_rdc' ? 'false' : 'a_verifier'
      }
    };

    if (shouldArchive) {
      patch.isArchived = true;
      patch.isNew = false;
      patch.isRecommended = false;
      summary.archived++;
    }

    await Opportunity.updateOne({ _id: opp._id }, { $set: patch });
    if (!nextRecommended) await demoteAlerts(opp._id);
    summary.updated++;
  }

  logger.info(`Rescore: ${JSON.stringify({ ...summary, examples: summary.examples.length })}`);
  return summary;
}

export async function reclassifyOpportunities(opts = {}) {
  return rescoreStoredOpportunities(opts);
}
