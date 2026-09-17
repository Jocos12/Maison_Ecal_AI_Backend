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

export const PLATFORMS = [
  'ReliefWeb',
  'UNGM',
  'DevEx',
  'ProfilRDC',
  'AchatPublicRDC',
  'SIGMAP',
  'ARSP',
  'UNjobs',
  'HDX',
  'WorldBank',
  'AfDB',
  'GoogleCustomSearch',
  'Other'
];

/** Offres sans date de clôture : archivées après N jours (publication ou première détection). */
export const STALE_NO_DEADLINE_DAYS = Math.max(
  14,
  Number(process.env.STALE_NO_DEADLINE_DAYS || 45)
);

export const NEW_OPPORTUNITY_DAYS = Math.max(
  1,
  Number(process.env.NEW_OPPORTUNITY_DAYS || 7)
);

/** Score 0–1 au-delà duquel une offre est « fortement recommandée » pour M-ECAL. */
export const HIGH_RELEVANCE_THRESHOLD = Math.min(
  1,
  Math.max(0.5, Number(process.env.HIGH_RELEVANCE_THRESHOLD || 0.7))
);

/** Un cycle de 30 min est considéré en retard au-delà de 45 minutes. */
export const SCRAPE_STALE_AFTER_MS = Math.max(
  30 * 60 * 1000,
  Number(process.env.SCRAPE_STALE_AFTER_MS || 45 * 60 * 1000)
);

/** Filet node-cron + rate limit HTTP : ne pas relancer si un scan a moins de 25 min. */
export const SCRAPE_SAFETY_NET_MS = Math.max(
  20 * 60 * 1000,
  Number(process.env.SCRAPE_SAFETY_NET_MS || 25 * 60 * 1000)
);

/** Alerte e-mail administrateur si aucun scan réussi depuis 2 h. */
export const SCRAPE_CRITICAL_AFTER_MS = Math.max(
  SCRAPE_STALE_AFTER_MS,
  Number(process.env.SCRAPE_CRITICAL_AFTER_MS || 2 * 60 * 60 * 1000)
);

/** Durée max d’un cycle de collecte (OCR inclus). Défaut 25 min. */
export const SCAN_TIMEOUT_MS = Math.max(
  15 * 60 * 1000,
  Number(process.env.SCAN_TIMEOUT_MS || 25 * 60 * 1000)
);

/** Logs leftover in "running" after a process crash / restart. */
export const ORPHAN_SCAN_MESSAGE = 'Scan interrompu - processus arrêté avant la fin';

export const CATEGORIES = [
  'formation',
  'formation_chauffeurs',
  'consultance',
  'inventaire_actifs',
  'inventaire_general',
  'etude_marche'
];
