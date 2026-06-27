/**
 * Filtres dédiés aux sources de veille complémentaires (DevEx, UNGM, AfDB).
 * N'altère pas businessRules.js ni filterService.js.
 */

export const RDC_LOCATION_TERMS = [
  'democratic republic of congo',
  'democratic republic of the congo',
  'république démocratique du congo',
  'republique democratique du congo',
  ' drc ',
  ' rdc ',
  '-rdc-',
  '-drc-',
  'congo-kinshasa',
  'kinshasa',
  'lubumbashi',
  'goma',
  'bukavu',
  'kalemie',
  'matadi',
  'kisangani',
  'beni',
  'butembo',
  'bunia'
];

export const DEVEX_VEILLE_KEYWORDS = [
  'logistique',
  'logistics',
  'transport',
  'supply chain',
  'supply-chain',
  'consultance',
  'consulting',
  'consultancy',
  'warehouse',
  'entrepot',
  'entrepôt',
  'distribution',
  'fleet',
  'procurement',
  'chaîne d approvisionnement'
];

export const UNGM_LOGISTICS_KEYWORDS = [
  'transport',
  'entreposage',
  'warehouse',
  'warehousing',
  'storage',
  'supply chain',
  'supply-chain',
  'logistics',
  'logistique',
  'freight',
  'distribution',
  'fleet',
  'humanitarian logistics',
  'cargo',
  'cold chain',
  'chaîne du froid'
];

export const AFDB_VEILLE_KEYWORDS = [
  'infrastructure',
  'transport',
  'logistics',
  'logistique',
  'road',
  'route',
  'routier',
  'port',
  'railway',
  'rail',
  'pont',
  'bridge',
  'autoroute',
  'highway',
  'corridor'
];

function normalizeBlob(item = {}) {
  return `${item.title || ''} ${item.description || ''} ${item.location || ''} ${item.organization || ''}`
    .toLowerCase()
    .normalize('NFD')
    .replace(/\p{M}/gu, '');
}

export function matchesRdcLocation(blob = '') {
  const text = ` ${blob} `;
  return RDC_LOCATION_TERMS.some((term) => text.includes(term));
}

export function matchesCategoryKeywords(blob = '', keywords = []) {
  return keywords.some((kw) => blob.includes(kw.toLowerCase()));
}

function filterVeilleItems(items = [], { categoryKeywords, requireRdc = true } = {}) {
  return items.filter((item) => {
    const blob = normalizeBlob(item);
    if (requireRdc && !matchesRdcLocation(blob)) return false;
    return matchesCategoryKeywords(blob, categoryKeywords);
  });
}

export function filterDevexVeilleItems(items = []) {
  return filterVeilleItems(items, { categoryKeywords: DEVEX_VEILLE_KEYWORDS, requireRdc: true });
}

export function filterUngmLogisticsVeilleItems(items = []) {
  return filterVeilleItems(items, { categoryKeywords: UNGM_LOGISTICS_KEYWORDS, requireRdc: true });
}

export function filterAfdbVeilleItems(items = []) {
  return filterVeilleItems(items, { categoryKeywords: AFDB_VEILLE_KEYWORDS, requireRdc: true });
}
