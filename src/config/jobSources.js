/**
 * Registre central des sources Assistant Emploi — labels et métadonnées.
 */
export const JOB_SOURCE_REGISTRY = [
  {
    name: 'reliefweb',
    label: 'ReliefWeb',
    type: 'api',
    manualUrl: 'https://reliefweb.int/jobs?search=logistics&advanced-search=%28C250%29'
  },
  {
    name: 'mediacongo',
    label: 'MediaCongo.net',
    type: 'scrape',
    baseUrl: 'https://www.mediacongo.net',
    manualUrl: 'https://www.mediacongo.net/emplois.html',
    crawlDelayMs: 10000
  },
  {
    name: 'unjobnet',
    label: 'UNjobnet (ONU/ONG)',
    type: 'scrape',
    baseUrl: 'https://www.unjobnet.org',
    manualUrl: 'https://www.unjobnet.org/countries/Democratic%20Republic%20of%20the%20Congo'
  },
  {
    name: 'coordination_sud',
    label: 'Coordination Sud',
    type: 'scrape',
    baseUrl: 'https://www.coordinationsud.org',
    manualUrl: 'https://www.coordinationsud.org/offres-emploi/',
    description: 'Réseau ONG françaises — offres humanitaires Afrique'
  },
  {
    name: 'impact_pool',
    label: 'Impact Pool',
    type: 'scrape',
    baseUrl: 'https://www.impactpool.org',
    manualUrl: 'https://www.impactpool.org/jobs?location=Democratic+Republic+of+the+Congo',
    description: 'Plateforme internationale UN/ONG — supply chain & logistique'
  }
];

export function getJobSourceLabel(name) {
  return JOB_SOURCE_REGISTRY.find((s) => s.name === name)?.label || name;
}

export function getActiveJobSourceLabels() {
  return JOB_SOURCE_REGISTRY.map((s) => s.label);
}

export function getManualSearchLinks() {
  return JOB_SOURCE_REGISTRY.filter((s) => s.manualUrl).map((s) => ({
    label: `${s.label} — emplois RDC`,
    url: s.manualUrl
  }));
}
