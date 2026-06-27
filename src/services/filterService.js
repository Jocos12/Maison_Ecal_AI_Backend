import { INCLUDE_KEYWORDS, EXCLUDE_KEYWORDS } from '../config/constants.js';
import {
  assessRdcLocation,
  classifyMecalCategory,
  findKeywordMatches,
  hasAiProviders,
  isEligibleForAiReview,
  isJobPosting,
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

  if (includesAny(blob, NON_LOGISTICS_EXCLUSIONS)) {
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

  if (hasAiProviders() && isEligibleForAiReview(blob) && trustedRdcSource) {
    return {
      accept: true,
      reason: 'needs_ai_review',
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
