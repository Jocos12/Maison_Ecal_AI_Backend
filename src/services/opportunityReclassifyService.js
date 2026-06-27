import Opportunity from '../models/Opportunity.js';
import { analyzeOpportunity } from './filterService.js';
import { analyzeOpportunityForMecal } from './aiClassifierService.js';
import {
  assessRdcLocation,
  classifyMecalCategory,
  mapAiCategoryToSlug,
  resolveVille
} from '../config/businessRules.js';
import logger from '../utils/logger.js';

function hasAiProvider() {
  return Boolean(process.env.ANTHROPIC_API_KEY || process.env.GROQ_API_KEY || process.env.GEMINI_API_KEY);
}

/**
 * Recalcule catégorie, statut géographique et pertinence métier des opportunités existantes.
 */
export async function reclassifyOpportunities({ useAI = false, dryRun = false, includeArchived = false } = {}) {
  const query = includeArchived ? {} : { isArchived: false };
  const opportunities = await Opportunity.find(query).sort({ createdAt: -1 });
  const summary = {
    total: opportunities.length,
    updated: 0,
    archived: 0,
    kept: 0,
    aVerifier: 0,
    rdcConfirme: 0,
    jobsRejected: 0,
    horsRdc: 0,
    dryRun
  };

  for (const opp of opportunities) {
    const analysis = analyzeOpportunity({
      title: opp.title,
      description: opp.description || '',
      organization: opp.organization || '',
      location: opp.location || ''
    });

    const shouldArchive =
      !analysis.accept ||
      analysis.reason === 'job_posting' ||
      analysis.reason === 'hors_rdc' ||
      analysis.reason === 'exclude_keyword';

    let category = analysis.category || classifyMecalCategory(`${opp.title} ${opp.description || ''}`);
    let locationStatus = analysis.locationStatus || opp.locationStatus || 'a_verifier';
    let ville = analysis.ville || resolveVille({
      title: opp.title,
      description: opp.description || '',
      location: opp.location || ''
    });
    let aiAnalysis = opp.aiAnalysis || {};
    let aiRelevanceScore = opp.aiRelevanceScore;

    if (!shouldArchive && useAI && hasAiProvider()) {
      try {
        const ai = await analyzeOpportunityForMecal({
          title: opp.title,
          description: opp.description || '',
          organization: opp.organization || '',
          ville,
          location: opp.location || ''
        });
        aiAnalysis = ai;
        if (ai.est_emploi || !ai.est_service || ai.categorie === 'non pertinent' || ai.pays_confirme_rdc === 'false') {
          summary.jobsRejected += ai.est_emploi ? 1 : 0;
          summary.horsRdc += ai.pays_confirme_rdc === 'false' ? 1 : 0;
          if (!dryRun) {
            await Opportunity.updateOne(
              { _id: opp._id },
              {
                $set: {
                  isArchived: true,
                  isNew: false,
                  locationStatus: ai.pays_confirme_rdc === 'false' ? 'hors_rdc' : locationStatus,
                  aiAnalysis: ai
                }
              }
            );
          }
          summary.archived++;
          continue;
        }
        const mapped = mapAiCategoryToSlug(ai.categorie);
        if (mapped) category = mapped;
        if (ai.pays_confirme_rdc === 'true') locationStatus = 'rdc_confirme';
        else if (ai.pays_confirme_rdc === 'a_verifier') locationStatus = 'a_verifier';
        aiRelevanceScore = Math.min(1, Math.max(0, Number(ai.score || 0) / 100));
      } catch (e) {
        logger.warn(`Reclassify AI skipped for ${opp._id}: ${e.message}`);
      }
    }

    if (shouldArchive) {
      if (analysis.reason === 'job_posting' || analysis.reason === 'exclude_keyword') summary.jobsRejected++;
      if (analysis.reason === 'hors_rdc') summary.horsRdc++;
      if (!dryRun) {
        await Opportunity.updateOne(
          { _id: opp._id },
          {
            $set: {
              isArchived: true,
              isNew: false,
              locationStatus: analysis.locationStatus || 'hors_rdc',
              category: category || opp.category,
              ville: ville || opp.ville,
              aiAnalysis: {
                ...aiAnalysis,
                est_emploi: analysis.type === 'offre_emploi',
                est_service: false,
                type: analysis.type || 'offre_emploi',
                justification: `Reclassifié: ${analysis.reason}`
              }
            }
          }
        );
      }
      summary.archived++;
      continue;
    }

    if (!dryRun) {
      await Opportunity.updateOne(
        { _id: opp._id },
        {
          $set: {
            category,
            locationStatus,
            ville: ville || opp.ville,
            aiAnalysis: {
              ...aiAnalysis,
              est_emploi: false,
              est_service: true,
              type: 'service',
              pays_confirme_rdc:
                locationStatus === 'rdc_confirme' ? 'true' : locationStatus === 'hors_rdc' ? 'false' : 'a_verifier'
            },
            ...(aiRelevanceScore != null ? { aiRelevanceScore } : {})
          }
        }
      );
    }

    summary.updated++;
    summary.kept++;
    if (locationStatus === 'a_verifier') summary.aVerifier++;
    if (locationStatus === 'rdc_confirme') summary.rdcConfirme++;
  }

  return summary;
}
