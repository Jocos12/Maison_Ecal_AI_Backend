import {
  EMPLOIS_EXCLUS,
  SERVICES_INCLUS,
  SERVICE_INCLUSION_SIGNALS,
  RDC_STRONG_KEYWORDS,
  VILLES_CIBLES
} from './businessRules.js';

/** Keywords: at least one must match (include) */
export const INCLUDE_KEYWORDS = [...SERVICES_INCLUS, ...SERVICE_INCLUSION_SIGNALS];

/** If any match -> reject (job postings etc.) */
export const EXCLUDE_KEYWORDS = EMPLOIS_EXCLUS;

/** At least one strongly suggests RDC geography */
export const DRC_KEYWORDS = [...RDC_STRONG_KEYWORDS, ...VILLES_CIBLES.map((v) => v.toLowerCase())];

/** Appended to web search queries for RDC targeting */
export const RDC_SEARCH_SUFFIX = 'RDC OR "République Démocratique du Congo" OR Kinshasa OR Lubumbashi OR Goma OR Bukavu';

export const PLATFORMS = ['ReliefWeb', 'UNGM', 'DevEx', 'ProfilRDC', 'AchatPublicRDC', 'UNjobs', 'HDX', 'WorldBank', 'AfDB', 'GoogleCustomSearch', 'Other'];

export const CATEGORIES = [
  'formation',
  'formation_chauffeurs',
  'consultance',
  'inventaire_actifs',
  'inventaire_general',
  'etude_marche'
];
