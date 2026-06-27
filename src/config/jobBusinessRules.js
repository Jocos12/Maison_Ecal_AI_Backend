/**
 * Règles métier EMPLOI — module séparé de la veille services (businessRules.js).
 * Ici on INCLUT les postes que la veille EXCLUT volontairement.
 */
import { assessRdcLocation, detectTargetCity, isRdcTrustedPlatform, normalizeText, includesAny } from './businessRules.js';

export const LOGISTICS_JOB_KEYWORDS = [
  'logistique',
  'logistics',
  'logistic',
  'magasinier',
  'warehouse',
  'entrepot',
  'entrepôt',
  'supply chain',
  'chaine d approvisionnement',
  'stock',
  'stocks',
  'distribution',
  'acheminement',
  'fleet',
  'parc automobile',
  'chauffeur',
  'driver',
  'dispatch',
  'procurement officer',
  'achats logistiques',
  'inventory clerk',
  'storekeeper',
  'officier logistique',
  'assistant logistique',
  'manager logistique',
  'responsable logistique',
  'coordinateur logistique',
  'superviseur logistique',
  'head of logistics',
  'logistics officer',
  'logistics manager',
  'logistics assistant'
];

export const JOB_POSTING_SIGNALS = [
  'offre d emploi',
  "offre d'emploi",
  'job vacancy',
  'we are hiring',
  'recrutement',
  'poste vacant',
  'cdi',
  'cdd',
  ' h/f',
  'full-time',
  'full time',
  'apply now',
  'candidature',
  'vacancy',
  'job opening'
];

export function isLogisticsJobPosting(text = '') {
  const normalized = normalizeText(text);
  const hasLogistics = includesAny(normalized, LOGISTICS_JOB_KEYWORDS);
  const hasJobSignal =
    includesAny(normalized, JOB_POSTING_SIGNALS) ||
    /career_categories|job type|closing date/i.test(text);
  return hasLogistics && (hasJobSignal || normalized.includes('job'));
}

export function isJobInRdc(text = '', location = '', platform = '') {
  const trusted = isRdcTrustedPlatform(platform);
  return assessRdcLocation(`${text} ${location}`, location, { trustedRdcSource: trusted }) === 'rdc_confirme';
}

export function extractJobCity(text = '', location = '') {
  return detectTargetCity(`${text} ${location}`) || 'RDC';
}

export function filterJobListings(items = []) {
  return items.filter((item) => {
    const blob = `${item.title} ${item.description || ''} ${item.organization || ''}`;
    if (!isJobInRdc(blob, item.location || '', item.platform || '')) return false;
    if (item.platform === 'ReliefWeb' || item.platform === 'MediaCongo' || item.platform === 'UNjobnet' || item.platform === 'Coordination Sud' || item.platform === 'Impact Pool') {
      const blobNorm = normalizeText(blob);
      if (includesAny(blobNorm, LOGISTICS_JOB_KEYWORDS)) return true;
      if (item.platform === 'Coordination Sud' || item.platform === 'Impact Pool') {
        return /congo|rdc|drc|kinshasa|lubumbashi|goma|bukavu|logist|supply|warehouse|transport|humanit/.test(
          blobNorm
        );
      }
      return false;
    }
    return isLogisticsJobPosting(blob);
  });
}
