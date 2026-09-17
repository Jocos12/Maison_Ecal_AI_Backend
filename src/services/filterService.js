import { INCLUDE_KEYWORDS, EXCLUDE_KEYWORDS } from '../config/constants.js';
import {
  assessRdcLocation,
  classifyMecalCategory,
  findKeywordMatches,
  hasAiProviders,
  isEligibleForAiReview,
  isJobPosting,
  isNotATender,
  isRdcTrustedPlatform,
  MECAL_CATEGORY_KEYWORDS,
  NON_LOGISTICS_EXCLUSIONS,
  includesAny,
  resolveVille
} from '../config/businessRules.js';

/**
 * Returns { accept, reason, rawKeywords, category, locationStatus, ville, needsAiReview } for a scraped item.
 */
export function analyzeOpportunity(
  { title = '', description = '', organization = '', location = '', platform = '' },
  { extraInclude = [] } = {}
) {
  const blob = `${title}\n${description}\n${organization}\n${location}`;
  const trustedRdcSource = isRdcTrustedPlatform(platform);

  if (isNotATender(title)) {
    return {
      accept: false,
      reason: 'not_a_tender',
      rawKeywords: [],
      category: null,
      locationStatus: null,
      type: 'autre',
      needsAiReview: false
    };
  }

  if (isJobPosting(blob)) {
    const jobHits = findKeywordMatches(blob, EXCLUDE_KEYWORDS);
    return {
      accept: false,
      reason: 'job_posting',
      rawKeywords: jobHits,
      category: null,
      locationStatus: null,
      type: 'offre_emploi',
      needsAiReview: false
    };
  }

  if (includesAny(blob, NON_LOGISTICS_EXCLUSIONS) && classifyMecalCategory(blob) === null) {
    return {
      accept: false,
      reason: 'non_logistics',
      rawKeywords: findKeywordMatches(blob, NON_LOGISTICS_EXCLUSIONS),
      category: null,
      locationStatus: null,
      type: 'autre',
      needsAiReview: false
    };
  }

  const locationStatus = assessRdcLocation(blob, location, { trustedRdcSource });
  if (locationStatus === 'hors_rdc') {
    return {
      accept: false,
      reason: 'hors_rdc',
      rawKeywords: [],
      category: null,
      locationStatus,
      type: 'service',
      needsAiReview: false
    };
  }

  const ville = resolveVille({ title, description, location });
  let category = classifyMecalCategory(blob);

  if (category) {
    const categoryKeywords = [...(MECAL_CATEGORY_KEYWORDS[category] || []), ...extraInclude.map((s) => String(s).toLowerCase())];
    const includeHits = findKeywordMatches(blob, [...INCLUDE_KEYWORDS, ...categoryKeywords]);
    return {
      accept: true,
      reason: 'ok',
      rawKeywords: [...new Set(includeHits)],
      category,
      ville,
      locationStatus: 'rdc_confirme',
      type: 'service',
      needsAiReview: false
    };
  }

  if (trustedRdcSource && isEligibleForAiReview(blob)) {
    return {
      accept: true,
      reason: hasAiProviders() ? 'needs_ai_review' : 'trusted_rdc_procurement',
      rawKeywords: [],
      category: null,
      ville,
      locationStatus,
      type: 'service',
      needsAiReview: true
    };
  }

  return {
    accept: false,
    reason: 'not_mecal_service',
    rawKeywords: [],
    category: null,
    locationStatus,
    type: 'autre',
    needsAiReview: false
  };
}

export function sanitizeSearchParam(q) {
  if (q == null) return '';
  return String(q).replace(/[^\p{L}\p{N}\s\-_.]/gu, '').slice(0, 120);
}

const RDC_NATIVE_PLATFORMS = new Set(['ARSP', 'SIGMAP', 'ProfilRDC', 'AchatPublicRDC']);

/** Offres affichables comme « logistique RDC » (même analyse que l’ingest, rejouée sur le stock). */
export function passesMecalListingFilter(opp = {}) {
  if (opp.isArchived) return false;
  if (opp.locationStatus === 'hors_rdc') return false;
  if (opp.aiAnalysis?.est_emploi === true || opp.aiAnalysis?.type === 'offre_emploi') return false;

  const analysis = analyzeOpportunity({
    title: opp.title || '',
    description: opp.description || '',
    organization: opp.organization || '',
    location: [opp.location, opp.ville].filter(Boolean).join(' '),
    platform: opp.platform || ''
  });

  if (!analysis.accept) return false;
  if (analysis.locationStatus === 'hors_rdc') return false;
  if (analysis.type === 'offre_emploi') return false;

  if (RDC_NATIVE_PLATFORMS.has(opp.platform)) return true;
  return Boolean(analysis.category);
}
