import { HIGH_RELEVANCE_THRESHOLD } from '../config/constants.js';
import {
  classifyMecalCategory,
  findKeywordMatches,
  includesAny,
  isJobPosting,
  NON_LOGISTICS_EXCLUSIONS,
  NON_RDC_COUNTRY_KEYWORDS,
  RDC_STRONG_KEYWORDS,
  SERVICES_INCLUS
} from '../config/businessRules.js';
import { analyzeOpportunity } from './filterService.js';
import { callAIForJSON, recordAiUsage } from './aiService.js';
import logger from '../utils/logger.js';

const PROFILE =
  process.env.MECAL_MATCH_PROFILE ||
  `Maison d'Études, de Conseil et d'Assistance Logistique (M-ECAL), RDC.
Services uniquement (pas d'emplois salariés) :
- formations procédures logistiques
- formation chauffeurs / conduite défensive
- inventaires d'actifs et inventaires généraux
- études de marché logistique / commerciale
- consultance, assistance et conseils supply chain, stocks, entrepôts, distribution.`;

/** Santé / humanitaire pur : le fallback mots-clés ne doit pas scorer positivement. */
const KEYWORD_HEALTH_HUMANITARIAN = [
  'food security',
  'securite alimentaire',
  'sécurité alimentaire',
  'ebola',
  'cholera',
  'choléra',
  'mpox',
  'outbreak',
  'epidemie',
  'épidémie',
  'nutrition',
  'humanitarian',
  'humanitaire',
  'wash',
  'sante',
  'santé',
  'health',
  'medical',
  'médical',
  'medicament',
  'protection vbg',
  'gender-based violence'
];

function clamp01(n) {
  const x = Number(n);
  if (Number.isNaN(x)) return 0;
  if (x > 1 && x <= 100) return Math.min(1, x / 100);
  return Math.min(1, Math.max(0, x));
}

function scoringBlob(row = {}, analysis = {}) {
  return `${row.title || ''}\n${row.description || ''}\n${row.organization || ''}\n${row.location || ''}\n${analysis.category || row.category || ''}`;
}

/**
 * Mêmes exclusions que l’ingest (job_posting, non_logistics, hors_rdc, not_mecal_service),
 * plus des gardes propres au fallback : RDC explicite, pas un autre pays, pas santé/humanitaire.
 */
export function keywordFallbackGate(row = {}, analysis = {}) {
  const filter = analyzeOpportunity({
    title: row.title || '',
    description: row.description || '',
    organization: row.organization || '',
    location: row.location || '',
    platform: row.platform || ''
  });
  if (!filter.accept) {
    return { ok: false, reason: filter.reason || 'not_mecal_service' };
  }

  const blob = scoringBlob(row, analysis);
  if (isJobPosting(blob)) {
    return { ok: false, reason: 'job_posting' };
  }
  if (/\blogistics coordinator\b|\bcoordinateur(?:trice)?\s+logistique\b|\blogistics officer\b/i.test(blob)) {
    return { ok: false, reason: 'job_posting' };
  }
  if (includesAny(blob, NON_LOGISTICS_EXCLUSIONS)) {
    return { ok: false, reason: 'non_logistics' };
  }
  if (includesAny(blob, KEYWORD_HEALTH_HUMANITARIAN)) {
    return { ok: false, reason: 'non_logistics' };
  }
  if (includesAny(blob, NON_RDC_COUNTRY_KEYWORDS)) {
    return { ok: false, reason: 'hors_rdc' };
  }
  if (!includesAny(blob, RDC_STRONG_KEYWORDS)) {
    return { ok: false, reason: 'hors_rdc' };
  }
  return { ok: true, reason: filter.reason || 'ok' };
}

export function keywordMatchScore(row = {}, analysis = {}) {
  const gate = keywordFallbackGate(row, analysis);
  if (!gate.ok) return 0;

  const blob = scoringBlob(row, analysis);
  const hits = findKeywordMatches(blob, SERVICES_INCLUS);
  const cat = classifyMecalCategory(blob);
  let score = 0;
  if (cat) score += 0.25;
  score += Math.min(0.35, hits.length * 0.08);
  if (
    /consultance logistique|conseil logistique|assistance logistique|logistics consulting|logistics consultancy|supply chain consulting|supply chain consultancy|conseil (en )?supply chain|consultance supply chain|\bformation\b|\binventaire\b|etude de marche|étude de marché|\bentrepot\b|\bentrepôt\b/i.test(
      blob
    )
  ) {
    score += 0.1;
  }
  return clamp01(score);
}

const SCORING_SYSTEM_PROMPT =
  'Tu scores des appels d’offres pour une firme de services logistiques en RDC. ' +
  'Cette offre doit être un appel d’offres, un avis de marché, ou une offre de prestation à laquelle une entreprise peut candidater — PAS un rapport de situation, un bulletin d’information, ou un document de suivi humanitaire, même s’il mentionne la logistique. ' +
  'Si le document n’a pas de processus de candidature clair, attribue un score de 0 et recommandee=false.';

function scoringUserPrompt(row, analysis = {}) {
  return `Profil M-ECAL:\n${PROFILE}\n\nOffre:\nTitre: ${row.title}\nOrganisation: ${row.organization || ''}\nCatégorie heuristique: ${analysis.category || ''}\nLieu: ${row.location || ''}\nDescription: ${String(row.description || '').slice(0, 2500)}\n\nNote la pertinence pour M-ECAL (prestation de services logistiques en RDC, pas un emploi).\nCette offre doit être un appel d’offres, un avis de marché, ou une offre de prestation à laquelle une entreprise peut candidater — PAS un rapport de situation, un bulletin d’information, ou un document de suivi humanitaire, même s’il mentionne la logistique. Si le document n’a pas de processus de candidature clair, attribue un score de 0.\nJSON: {"score":0-100,"recommandee":true|false,"justification":"une phrase"}`;
}

export async function scoreOpportunityForMecal(row, analysis = {}) {
  const filter = analyzeOpportunity({
    title: row.title || '',
    description: row.description || '',
    organization: row.organization || '',
    location: row.location || '',
    platform: row.platform || ''
  });
  if (!filter.accept) {
    return {
      score: 0,
      recommended: false,
      provider: 'filter',
      justification: `Exclu avant scoring (${filter.reason}) — pas un marché / hors filtre.`
    };
  }

  const gate = keywordFallbackGate(row, analysis);
  const fallbackScore = keywordMatchScore(row, analysis);
  const fallback = {
    score: fallbackScore,
    recommended: gate.ok && fallbackScore >= HIGH_RELEVANCE_THRESHOLD,
    provider: 'keywords',
    justification: gate.ok
      ? 'Score de secours par mots-clés (profil M-ECAL).'
      : `Score de secours : exclu (${gate.reason}) — mêmes filtres que le scoring IA.`
  };

  try {
    const { data, provider } = await callAIForJSON(scoringUserPrompt(row, analysis), SCORING_SYSTEM_PROMPT);
    const score = clamp01(data.score);
    const recommended =
      data.recommandee === true || data.recommended === true || score >= HIGH_RELEVANCE_THRESHOLD;
    return {
      score,
      recommended,
      provider,
      justification: String(data.justification || '').slice(0, 400)
    };
  } catch (e) {
    recordAiUsage('keywords');
    logger.info(
      `Matching M-ECAL: IA indisponible (${e.message.slice(0, 120)}) — score mots-clés ${Math.round(fallbackScore * 100)}${gate.ok ? '' : ` exclu=${gate.reason}`}`
    );
    return fallback;
  }
}
