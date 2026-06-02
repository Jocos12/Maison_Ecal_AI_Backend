import { EMPLOIS_EXCLUS, SERVICES_INCLUS, VILLES_CIBLES } from './businessRules.js';

/** Keywords: at least one must match (include) */
export const INCLUDE_KEYWORDS = SERVICES_INCLUS;

/** If any match -> reject (job postings etc.) */
export const EXCLUDE_KEYWORDS = EMPLOIS_EXCLUS;

/** At least one must match for DRC geography */
export const DRC_KEYWORDS = [
  'rdc',
  'drc',
  'r.d.c',
  'république démocratique',
  'republique democratique',
  'democratic republic',
  'congo',
  'kinshasa',
  'goma',
  'lubumbashi',
  'bukavu',
  'butembo',
  'beni',
  'kisangani',
  'matadi',
  'mbuji-mayi',
  'mbuji mayi',
  'kananga',
  'nord-kivu',
  'sud-kivu',
  'katanga',
  'lualaba',
  'haut-katanga',
  'ituri',
  'kasaï',
  'kasai',
  'équateur',
  'equateur',
  'tanganyika',
  'maniema',
  'tshopo',
  'bas-uele',
  'haut-uele',
  'mongala',
  'nord-ubangi',
  'sud-ubangi',
  'kwilu',
  'kwango',
  'kongo central',
  'kinshasa province',
  'cod',
  'congo-kinshasa',
  ...VILLES_CIBLES
];

export const PLATFORMS = ['ReliefWeb', 'UNGM', 'DevEx', 'ProfilRDC', 'AchatPublicRDC', 'UNjobs', 'HDX', 'WorldBank', 'AfDB', 'GoogleCustomSearch', 'Other'];

export const CATEGORIES = ['formation', 'formation_chauffeurs', 'consultance', 'inventaire_actifs', 'inventaire_general', 'etude_marche', 'assistance'];
