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
    url: 'https://www.devex.com/funding/r',
    scraperKey: 'DevEx',
    description: 'Funding Devex (souvent payant Devex Pro). Ajoutez DEVEX_DISABLED=true si 0 résultat.',
    enabled: false
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
    url: 'https://www.afdb.org/en/documents/project-related-procurement/procurement-notices',
    scraperKey: 'AfDB',
    description: 'Avis d’acquisition BAD (RSS + notices) filtrés RDC / DRC.',
    enabled: true
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
    url: 'https://marche.armp-rdc.cd',
    scraperKey: 'AchatPublicRDC',
    description: 'Avis d’appels d’offres SIGMAP / ARMP.'
  },
  {
    key: 'ProfilRDC',
    name: 'Manifestations d’intérêt RDC',
    url: 'https://marche.armp-rdc.cd/categorie-poste/avis-a-manifestations-dinterets',
    scraperKey: 'ProfilRDC',
    description: 'Avis à manifestations d’intérêt (consultances) sur le portail ARMP.'
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

/** Sources complémentaires — ajoutées sans modifier DEFAULT_SOURCES existant */
export const ADDITIONAL_VEILLE_SOURCES = [
  {
    key: 'DevExVeille',
    name: 'DevEx, Veille RDC logistique',
    url: 'https://www.devex.com',
    scraperKey: 'DevExVeille',
    description:
      'Funding Devex, paywall Devex Pro (0 résultat sans abonnement). Désactivé par défaut.',
    frequencyHours: 12,
    enabled: false
  },
  {
    key: 'UNGMVeille',
    name: 'UNGM, Logistique humanitaire RDC',
    url: 'https://www.ungm.org',
    scraperKey: 'UNGMVeille',
    description:
      'Marchés UNGM RDC, transport, entreposage, supply chain humanitaire. Fréquence 12h.',
    frequencyHours: 12,
    enabled: true
  },
  {
    key: 'AfDBVeille',
    name: 'African Development Bank, Projets RDC',
    url: 'https://www.afdb.org/en/documents/project-related-procurement/procurement-notices',
    scraperKey: 'AfDBVeille',
    description:
      'Même corpus que African Development Bank Tenders (avis RDC). Fréquence 12h.',
    frequencyHours: 12,
    enabled: true
  },
  {
    key: 'SIGMAP',
    name: 'SIGMAP, Marché public RDC',
    url: 'https://marchepublic.cd/',
    scraperKey: 'SIGMAP',
    description: 'Portail SIGMAP (marchepublic.cd), avis d’appel d’offres et AMI RDC.',
    frequencyHours: 3,
    enabled: true
  },
  {
    key: 'ARSP',
    name: 'ARSP, Appels d’offres RDC',
    url: 'https://appeldoffre.arsp.cd/',
    scraperKey: 'ARSP',
    description: 'Appels d’offres ARSP avec date d’expiration réelle (En cours / Expiré).',
    frequencyHours: 3,
    enabled: true
  },
  {
    key: 'CoordinationSud',
    name: 'Coordination Sud',
    url: 'https://www.coordinationsud.org/offres-emploi/',
    scraperKey: null,
    description:
      "Réseau d'ONG françaises, offres emploi humanitaire Afrique (Assistant Emploi).",
    frequencyHours: 12,
    enabled: true
  },
  {
    key: 'ImpactPool',
    name: 'Impact Pool',
    url: 'https://www.impactpool.org/jobs',
    scraperKey: null,
    description:
      'Plateforme emploi ONG/UN internationale, supply chain & logistique (Assistant Emploi).',
    frequencyHours: 12,
    enabled: true
  }
];

export async function ensureDefaultSources() {
  for (const source of [...DEFAULT_SOURCES, ...ADDITIONAL_VEILLE_SOURCES]) {
    await Source.updateOne(
      { key: source.key },
      { $setOnInsert: { enabled: source.enabled !== false, frequencyHours: source.frequencyHours || 12, ...source } },
      { upsert: true }
    );
  }
  await Source.updateOne(
    { key: 'AfDB' },
    {
      $set: {
        enabled: true,
        scraperKey: 'AfDB',
        url: 'https://www.afdb.org/en/documents/project-related-procurement/procurement-notices',
        description: 'Avis d’acquisition BAD (RSS + notices) filtrés RDC / DRC.'
      }
    }
  );
  await Source.updateOne(
    { key: 'DevEx' },
    { $set: { enabled: false } }
  );
  await Source.updateOne(
    { key: 'DevExVeille' },
    { $set: { enabled: false } }
  );
}

export async function getActiveScraperKeys() {
  const rows = await Source.find({ enabled: true, scraperKey: { $ne: null } }).select('scraperKey').lean();
  return new Set(rows.map((row) => row.scraperKey));
}
