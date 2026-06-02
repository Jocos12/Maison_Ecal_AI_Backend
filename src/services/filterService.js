import {
  INCLUDE_KEYWORDS,
  EXCLUDE_KEYWORDS,
  DRC_KEYWORDS
} from '../config/constants.js';
import { detectTargetCity, findKeywordMatches, isServiceLogistique } from '../config/businessRules.js';

function normalize(text) {
  return (text || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '');
}

function findMatches(haystack, keywords) {
  const n = normalize(haystack);
  const matched = [];
  for (const kw of keywords) {
    if (n.includes(normalize(kw))) matched.push(kw);
  }
  return matched;
}

function inferCategory(text) {
  const t = normalize(text);
  if (/(chauffeur|driver|conduite|defensive driving)/.test(t)) return 'formation_chauffeurs';
  if (/(formation|training|workshop|atelier)/.test(t)) return 'formation';
  if (/(etude de marche|market study|feasibility|etude de faisabilite)/.test(t)) return 'etude_marche';
  if (/(inventaire general|general inventory)/.test(t)) return 'inventaire_general';
  if (/(actifs|asset inventory|assets inventory)/.test(t)) return 'inventaire_actifs';
  if (/(inventaire|inventory)/.test(t)) return 'inventaire_general';
  if (/(consult|conseil|advisory|assistance|appui|support technique)/.test(t)) return 'consultance';
  return 'assistance';
}

/**
 * Returns { accept, reason, rawKeywords, category } for a scraped item.
 * @param {object} opts
 * @param {string[]} [opts.extraInclude] — additional include phrases from user settings
 */
export function analyzeOpportunity(
  { title = '', description = '', organization = '' },
  { extraInclude = [] } = {}
) {
  const blob = `${title}\n${description}\n${organization}`;
  const includeList = [...INCLUDE_KEYWORDS, ...extraInclude.map((s) => String(s).toLowerCase())];
  const excludeHits = findKeywordMatches(blob, EXCLUDE_KEYWORDS);
  if (excludeHits.length > 0) {
    return { accept: false, reason: 'exclude_keyword', rawKeywords: excludeHits, category: null };
  }
  if (!isServiceLogistique({ title, description, organization })) {
    return { accept: false, reason: 'not_mecal_service', rawKeywords: [], category: null };
  }
  const includeHits = findMatches(blob, includeList);
  if (includeHits.length === 0) {
    return { accept: false, reason: 'no_include_match', rawKeywords: [], category: null };
  }
  const drcHits = findMatches(blob, DRC_KEYWORDS);
  const ville = detectTargetCity(blob);
  if (drcHits.length === 0 || !ville) {
    return { accept: false, reason: 'no_drc_geo', rawKeywords: includeHits, category: null };
  }
  const category = inferCategory(blob);
  return {
    accept: true,
    reason: 'ok',
    rawKeywords: [...new Set([...includeHits, ...drcHits])],
    category,
    ville
  };
}

export function sanitizeSearchParam(q) {
  if (q == null) return '';
  return String(q).replace(/[^\p{L}\p{N}\s\-_.]/gu, '').slice(0, 120);
}
