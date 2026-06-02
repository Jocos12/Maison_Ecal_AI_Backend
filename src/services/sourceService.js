import Source from '../models/Source.js';

export const DEFAULT_SOURCES = [
  {
    key: 'ReliefWeb',
    name: 'ReliefWeb',
    url: 'https://reliefweb.int',
    scraperKey: 'ReliefWeb',
    description: 'Consultancies, trainings et services humanitaires.'
  },
  {
    key: 'DevEx',
    name: 'DevEx',
    url: 'https://www.devex.com',
    scraperKey: 'DevEx',
    description: 'Marchés, consultances et opportunités développement.'
  },
  {
    key: 'UNjobs',
    name: 'UNjobs',
    url: 'https://unjobs.org',
    scraperKey: null,
    description: 'Surveillance mots-clés, avec exclusion stricte des offres d’emploi.',
    enabled: false
  },
  {
    key: 'HDX',
    name: 'Humanitarian Data Exchange',
    url: 'https://data.humdata.org',
    scraperKey: null,
    description: 'Sources de données humanitaires et appels à services.',
    enabled: false
  },
  {
    key: 'WorldBank',
    name: 'World Bank Procurement',
    url: 'https://projects.worldbank.org/en/projects-operations/procurement',
    scraperKey: null,
    description: 'Marchés Banque Mondiale liés aux services logistiques.',
    enabled: false
  },
  {
    key: 'AfDB',
    name: 'African Development Bank Tenders',
    url: 'https://www.afdb.org/en/about-us/corporate-procurement',
    scraperKey: null,
    description: 'Avis d’appels d’offres BAD.',
    enabled: false
  },
  {
    key: 'UNGM',
    name: 'UNGM',
    url: 'https://www.ungm.org',
    scraperKey: 'UNGM',
    description: 'Marchés publics des agences des Nations Unies.'
  },
  {
    key: 'AchatPublicRDC',
    name: 'Marchés publics RDC',
    url: 'https://armp-rdc.org',
    scraperKey: 'AchatPublicRDC',
    description: 'Sites gouvernementaux RDC et avis publics.'
  },
  {
    key: 'ProfilRDC',
    name: 'Profil RDC',
    url: 'https://www.profilrdc.com',
    scraperKey: 'ProfilRDC',
    description: 'Veille locale RDC.'
  },
  {
    key: 'GoogleCustomSearch',
    name: 'Google Custom Search',
    url: 'https://programmablesearchengine.google.com',
    scraperKey: null,
    description: 'Recherche web ciblée sur les mots-clés logistiques.',
    enabled: false
  }
];

export async function ensureDefaultSources() {
  for (const source of DEFAULT_SOURCES) {
    await Source.updateOne(
      { key: source.key },
      { $setOnInsert: { enabled: true, frequencyHours: 12, ...source } },
      { upsert: true }
    );
  }
}

export async function getActiveScraperKeys() {
  const rows = await Source.find({ enabled: true, scraperKey: { $ne: null } }).select('scraperKey').lean();
  return new Set(rows.map((row) => row.scraperKey));
}
