export const SERVICES_INCLUS = [
  'formation logistique',
  'formation procédures logistiques',
  'formation procedures logistiques',
  'formation supply chain',
  'formation chaine d approvisionnement',
  'formation chauffeur',
  'formation des chauffeurs',
  'conduite véhicule',
  'conduite vehicule',
  'conduite défensive',
  'conduite defensive',
  'formation conducteur',
  'driver training',
  'defensive driving',
  'étude de marché',
  'etude de marche',
  'étude marché',
  'etude marche',
  'market study',
  'market assessment',
  'analyse de marche',
  'inventaire actifs',
  "inventaire d'actifs",
  'inventaire des actifs',
  'inventaire général',
  'inventaire general',
  'asset inventory',
  'general inventory',
  'consultance logistique',
  'conseil logistique',
  'assistance logistique',
  'assistance en logistique',
  'appui logistique',
  'logistic consultancy',
  'logistics consultancy',
  'logistic training',
  'logistics training',
  'logistics consulting',
  'supply chain',
  'chaine d approvisionnement',
  'chaine logistique',
  'gestion des stocks',
  'gestion d entrepot',
  'gestion entrepot',
  'warehouse management',
  'distribution logistique',
  'acheminement',
  'prestation logistique',
  'service logistique',
  'mission logistique'
];

/** Mots-clés par catégorie M-ECAL (une seule catégorie logistique doit matcher). */
export const MECAL_CATEGORY_KEYWORDS = {
  formation: [
    'formation logistique',
    'formation procedure',
    'formation procédure',
    'formation procedures logistiques',
    'logistics training',
    'logistic training',
    'supply chain training',
    'formation supply chain',
    'formation chaine d approvisionnement',
    'formation en logistique',
    'atelier logistique',
    'workshop logistics'
  ],
  formation_chauffeurs: [
    'formation chauffeur',
    'formation des chauffeurs',
    'formation conducteur',
    'conduite véhicule',
    'conduite vehicule',
    'conduite défensive',
    'conduite defensive',
    'driver training',
    'defensive driving',
    'fleet driver',
    'conducteur de vehicule'
  ],
  etude_marche: [
    'etude de marche',
    'étude de marché',
    'etude marche',
    'market study',
    'market assessment',
    'analyse de marche',
    'analyse de marché',
    'market research',
    'etude commerciale'
  ],
  inventaire_actifs: [
    'inventaire des actifs',
    'inventaire d actifs',
    "inventaire d'actifs",
    'inventaire actifs',
    'asset inventory',
    'assets inventory',
    'inventaire immobilise',
    'inventaire immobilisations'
  ],
  inventaire_general: [
    'inventaire general',
    'inventaire général',
    'general inventory',
    'inventaire physique',
    'inventaire patrimoine',
    'inventaire organisation',
    'inventaire des',
    'realisation d un inventaire',
    "réalisation d'un inventaire",
    'mission d inventaire',
    "mission d'inventaire"
  ],
  consultance: [
    'consultance logistique',
    'conseil logistique',
    'assistance logistique',
    'assistance en logistique',
    'appui logistique',
    'logistics consultancy',
    'logistics consulting',
    'logistic consultancy',
    'supply chain',
    'chaine d approvisionnement',
    'chaine logistique',
    'gestion des stocks',
    'gestion logistique',
    'specialiste en logistique',
    'gestion d entrepot',
    'gestion entrepot',
    'warehouse management',
    'distribution logistique',
    'acheminement',
    'prestation logistique',
    'service logistique',
    'mission logistique',
    'appui en logistique',
    'support logistique'
  ]
};

/** Prestations hors périmètre M-ECAL (même si « consultance » ou « recrutement de firme »). */
export const NON_LOGISTICS_EXCLUSIONS = [
  'etude d impact environnemental',
  'etude impact environnemental',
  'eies',
  'esia',
  'environnemental',
  'assainissement',
  'assainir',
  'travaux routiers',
  'surveillance des travaux',
  'surveillance travaux',
  'audit technique',
  'ingenierie civile',
  'génie civil',
  'genie civil',
  'construction de route',
  'construction routiere',
  'forage',
  'eau potable',
  'hydraulique villageoise',
  'sante',
  'sanitaire',
  'medical',
  'medicament',
  'medicaments',
  'pharmaceutique',
  'cybersecurite',
  'cybersécurité',
  'informatique',
  'mobilier',
  'vehicules terrestres',
  'acquisition des vehicules',
  'acquisition de vehicules',
  'acquisition vehicule',
  'materiels informatiques',
  'equipements informatiques',
  'solutions monitoring reseau',
  'specialiste assainissement',
  'recrutement d un specialiste',
  'recrutement d une specialiste',
  'recrutement d un expert en',
  'recrutement d une expert en',
  'officier',
  'magasinier',
  'architecte',
  'topographe',
  'geologue',
  'veterinaire',
  'agronome',
  'juriste',
  'comptable',
  'communication',
  'branding',
  'visibilite',
  'security guard',
  'gardiennage'
];

/** Signaux d'inclusion : prestation / marché / mission (pas emploi) — nécessite aussi un mot-clé logistique. */
export const SERVICE_INCLUSION_SIGNALS = [
  'appel d offres',
  "appel d'offres",
  'appel à offres',
  'appel a offres',
  'demande de devis',
  'demande de proposition',
  'request for proposal',
  'request for quotation',
  'rfp',
  'rfq',
  'tdr',
  'termes de reference',
  'termes de référence',
  'terms of reference',
  'prestation',
  'mission de consultance',
  'mission de formation',
  'mission d assistance',
  "mission d'assistance",
  'marché public',
  'marche public',
  'avis de marché',
  'avis de marche',
  'contrat de prestation',
  'service contract',
  'to conduct an inventory',
  'inventory exercise'
];

/** Sélection de firme / prestation (langage marchés publics RDC — pas un emploi). */
export const PROCUREMENT_FIRM_SIGNALS = [
  'recrutement d une firme',
  "recrutement d'une firme",
  'recrutement d un cabinet',
  "recrutement d'un cabinet",
  'recrutement d une societe',
  "recrutement d'une société",
  'recrutement d un prestataire',
  'selection d une firme',
  'selection d un cabinet',
  'manifestation d interet',
  "manifestation d'intérêt",
  'manifestations d interet',
  'consultant individuel',
  'cabinet de consultants',
  'mission de consultance',
  'mission de formation',
  'termes de reference',
  'termes de référence',
  'appel d offres',
  "appel d'offres"
];

/** Titres de poste à exclure systématiquement. */
export const JOB_TITLE_EXCLUSIONS = [
  'magasinier',
  'magasinier logistique',
  'assistant logistique',
  'officier logistique',
  'manager logistique',
  'responsable logistique',
  'logistics manager',
  'logistics officer',
  'logistics assistant',
  'warehouse manager',
  'warehouse officer',
  'storekeeper',
  'chargé de logistique',
  'charge de logistique',
  'coordinateur logistique',
  'superviseur logistique',
  'head of logistics',
  'directeur logistique'
];

/** Signaux d'offre d'emploi / recrutement. */
export const JOB_SIGNALS = [
  'recrute',
  'recrutement',
  'nous recrutons',
  'poste de',
  'poste vacant',
  'cdi',
  'cdd',
  'contrat de travail',
  ' h/f',
  ' h / f',
  'f/h',
  'candidature',
  'cv et lettre de motivation',
  'envoyer votre cv',
  'job vacancy',
  'full-time employee',
  'permanent position',
  'we are hiring',
  'we are recruiting',
  'offre d emploi',
  "offre d'emploi",
  'avis de recrutement',
  'cherche candidat',
  'cv attendu',
  'emploi',
  'vacancy',
  'job opening',
  'hiring',
  'internship',
  'stagiaire',
  'recruitment'
];

export const EMPLOIS_EXCLUS = [...new Set([...JOB_TITLE_EXCLUSIONS, ...JOB_SIGNALS])];

/** Congo-Brazzaville — à ne pas confondre avec la RDC. */
export const CONGO_BRAZZAVILLE_KEYWORDS = [
  'congo-brazzaville',
  'republic of congo',
  'république du congo',
  'republique du congo',
  'brazzaville',
  'pointe-noire',
  'pointe noire',
  'congo brazzaville',
  'country=CG',
  'country_codes[]=CG',
  'cog-'
];

/** Pays / villes hors RDC — rejet si aucun signal RDC dans le même texte. */
export const NON_RDC_COUNTRY_KEYWORDS = [
  'kenya',
  'nairobi',
  'uganda',
  'kampala',
  'tanzania',
  'tanzanie',
  'dar es salaam',
  'rwanda',
  'kigali',
  'burundi',
  'bujumbura',
  'ethiopia',
  'ethiopie',
  'addis ababa',
  'senegal',
  'sénégal',
  'dakar',
  'mali',
  'bamako',
  'niger',
  'niamey',
  'chad',
  'tchad',
  'ndjamena',
  'cameroon',
  'cameroun',
  'yaounde',
  'yaoundé',
  'douala',
  'nigeria',
  'nigéria',
  'lagos',
  'abuja',
  'south sudan',
  'soudan du sud',
  'juba',
  'sudan',
  'soudan',
  'khartoum',
  'mozambique',
  'maputo',
  'angola',
  'luanda',
  'zambia',
  'zambie',
  'lusaka',
  'zimbabwe',
  'harare',
  'south africa',
  'afrique du sud',
  'ghana',
  'accra',
  'ivory coast',
  "côte d'ivoire",
  'cote d ivoire',
  'abidjan',
  'central african republic',
  'république centrafricaine',
  'bangui',
  'gabon',
  'libreville',
  'guinea',
  'guinée',
  'conakry',
  'somalia',
  'somalie',
  'mogadishu',
  'haiti',
  'haïti',
  'port-au-prince',
  'afghanistan',
  'syria',
  'syrie',
  'yemen',
  'yémen',
  'ukraine',
  'palestine',
  'gaza',
  'iraq',
  'irak',
  'lebanon',
  'liban',
  'jordan',
  'jordanie',
  'egypt',
  'égypte',
  'cairo',
  'malawi',
  'lilongwe',
  'madagascar',
  'benin',
  'bénin',
  'togo',
  'burkina',
  'ouagadougou',
  'pakistan',
  'india',
  'inde',
  'bangladesh',
  'philippines',
  'indonesia',
  'indonésie',
  'myanmar',
  'thailand',
  'thaïlande',
  'vietnam',
  'colombia',
  'colombie',
  'mexico',
  'mexique',
  'peru',
  'pérou',
  'brazil',
  'brésil',
  'chile',
  'chili'
];

/** Sources dont le scraping cible déjà exclusivement la RDC. */
export const RDC_TRUSTED_PLATFORMS = new Set([
  'ProfilRDC',
  'AchatPublicRDC',
  'ReliefWeb',
  'UNGM',
  'UNGMVeille',
  'DevEx',
  'DevExVeille',
  'AfDBVeille',
  'MediaCongo',
  'UNjobnet',
  'Coordination Sud',
  'Impact Pool'
]);

export function isRdcTrustedPlatform(platform = '') {
  return RDC_TRUSTED_PLATFORMS.has(String(platform || '').trim());
}

export const RDC_STRONG_KEYWORDS = [
  'rdc',
  'drc',
  'r.d.c',
  'république démocratique du congo',
  'republique democratique du congo',
  'democratic republic of the congo',
  'democratic republic of congo',
  'congo-kinshasa',
  'congo kinshasa',
  'ex-zaire',
  'ex zaire',
  'zaire',
  'cod',
  'kinshasa',
  'lubumbashi',
  'goma',
  'bukavu',
  'kalemie',
  'kisangani',
  'matadi',
  'mbuji-mayi',
  'kananga',
  'nord-kivu',
  'sud-kivu',
  'haut-katanga',
  'katanga',
  'lualaba',
  'ituri',
  'kasaï',
  'kasai',
  'équateur',
  'equateur',
  'tanganyika',
  'maniema',
  'tshopo',
  'kongo central'
];

export const VILLES_CIBLES = [
  'Bukavu',
  'Goma',
  'Kinshasa',
  'Kalemie',
  'Lubumbashi',
  'Sud-Kivu',
  'Nord-Kivu',
  'Katanga',
  'Haut-Katanga',
  'RDC',
  'République Démocratique du Congo',
  'Republique Democratique du Congo',
  'DRC',
  'Democratic Republic of Congo'
];

export const VILLES_BADGES = {
  Bukavu: 'green',
  Goma: 'blue',
  Kinshasa: 'orange',
  Kalemie: 'violet',
  Lubumbashi: 'red'
};

export const SERVICES_MECAL = [
  'Formations procédures logistiques',
  'Formation chauffeurs / conduite de véhicules',
  'Étude de marchés',
  "Inventaire d'Actifs d'une Organisation",
  "Inventaire général d'une Organisation",
  'Consultance, Assistance et Conseils en logistique'
];

export const CATEGORY_SLUGS = [
  'formation',
  'formation_chauffeurs',
  'etude_marche',
  'inventaire_actifs',
  'inventaire_general',
  'consultance'
];

export function normalizeText(value = '') {
  return String(value)
    .toLowerCase()
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '');
}

export function includesAny(text, keywords) {
  const normalized = normalizeText(text);
  return keywords.some((keyword) => normalized.includes(normalizeText(keyword)));
}

export function findKeywordMatches(text, keywords) {
  const normalized = normalizeText(text);
  return keywords.filter((keyword) => normalized.includes(normalizeText(keyword)));
}

export function isFirmProcurement(text = '') {
  const normalized = normalizeText(text);
  if (includesAny(normalized, PROCUREMENT_FIRM_SIGNALS)) return true;
  if (/recrutement d[' ]?(une|un)\s+(firme|cabinet|societe|prestataire|bureau)/.test(normalized)) return true;
  if (/selection d[' ]?(une|un)\s+(firme|cabinet|societe|prestataire)/.test(normalized)) return true;
  if (includesAny(normalized, SERVICE_INCLUSION_SIGNALS)) return true;
  return false;
}

export function isJobPosting(text = '') {
  const normalized = normalizeText(text);
  if (isFirmProcurement(text)) return false;
  if (includesAny(normalized, JOB_TITLE_EXCLUSIONS)) return true;
  if (/\b(assistant|officier|manager|responsable|magasinier|superviseur|coordinateur|directeur)\s+(de\s+)?logistique\b/.test(normalized)) {
    return true;
  }
  if (/\brecrutement d[' ]?un(e)?\s+(specialiste|expert|consultant individuel|ingenieur|architecte|comptable|juriste)\b/.test(normalized)) {
    if (!/\b(logistique|logistic|supply chain|inventaire|stock|entrepot|formation|marche)\b/.test(normalized)) {
      return true;
    }
  }
  if (includesAny(normalized, JOB_SIGNALS) && !isFirmProcurement(text)) {
    return true;
  }
  return false;
}

export function hasAiProviders() {
  return Boolean(process.env.ANTHROPIC_API_KEY || process.env.GROQ_API_KEY || process.env.GEMINI_API_KEY);
}

/** Avis marché RDC éligible à qualification IA (titre ARMP/UNGM souvent sans le mot « logistique »). */
export function isEligibleForAiReview(text = '') {
  if (isJobPosting(text)) return false;
  if (includesAny(text, NON_LOGISTICS_EXCLUSIONS)) return false;
  return isFirmProcurement(text);
}

/**
 * Retourne la catégorie M-ECAL (slug) ou null si hors périmètre logistique.
 */
export function classifyMecalCategory(text = '') {
  const normalized = normalizeText(text);
  if (includesAny(normalized, NON_LOGISTICS_EXCLUSIONS)) return null;

  const order = [
    'formation_chauffeurs',
    'formation',
    'etude_marche',
    'inventaire_actifs',
    'inventaire_general',
    'consultance'
  ];

  for (const slug of order) {
    const keywords = MECAL_CATEGORY_KEYWORDS[slug] || [];
    if (includesAny(normalized, keywords)) return slug;
  }

  return null;
}

export function isServiceOpportunity(text = '') {
  if (isJobPosting(text)) return false;
  if (includesAny(text, NON_LOGISTICS_EXCLUSIONS)) return false;
  return classifyMecalCategory(text) !== null;
}

/**
 * Politique stricte RDC : seules les opportunités confirmées en RDC sont acceptées.
 * @returns {'rdc_confirme'|'hors_rdc'}
 */
export function assessRdcLocation(text = '', explicitLocation = '', { trustedRdcSource = false } = {}) {
  const blob = normalizeText(`${text} ${explicitLocation}`);

  const hasRdcStrong = includesAny(blob, RDC_STRONG_KEYWORDS) || Boolean(detectTargetCity(blob));

  if (includesAny(blob, CONGO_BRAZZAVILLE_KEYWORDS) && !hasRdcStrong) {
    return 'hors_rdc';
  }

  if (includesAny(blob, NON_RDC_COUNTRY_KEYWORDS) && !hasRdcStrong) {
    return 'hors_rdc';
  }

  if (hasRdcStrong) {
    return 'rdc_confirme';
  }

  if (trustedRdcSource) {
    return 'rdc_confirme';
  }

  return 'hors_rdc';
}

export function detectTargetCity(input = '') {
  const text = normalizeText(input);
  const found = [];
  const canonical = ['Bukavu', 'Goma', 'Kinshasa', 'Kalemie', 'Lubumbashi'];
  for (const city of canonical) {
    if (text.includes(normalizeText(city))) found.push(city);
  }
  if (/(tanganyika|kalemie|moero)/.test(text) && !found.includes('Kalemie')) found.push('Kalemie');
  if (/(lualaba|luilu|kolwezi|haut-lomami|haut katanga)/.test(text) && !found.includes('Lubumbashi')) {
    found.push('Lubumbashi');
  }
  if (/(sud-kivu|sud kivu|uvira)/.test(text) && !found.includes('Bukavu')) found.push('Bukavu');
  if (/(nord-kivu|nord kivu|beni|butembo)/.test(text) && !found.includes('Goma')) found.push('Goma');
  if (/(haut-katanga|katanga)/.test(text) && !found.includes('Lubumbashi')) found.push('Lubumbashi');

  if (found.length > 1 && found.includes('Kinshasa')) {
    const local = found.find((c) => c !== 'Kinshasa');
    if (local) return local;
  }
  if (found.length) return found[0];

  if (includesAny(text, RDC_STRONG_KEYWORDS)) return 'RDC';
  return null;
}

/**
 * Déduit la ville à afficher (évite Kinshasa par défaut pour les marchés nationaux).
 */
export function resolveVille({ title = '', description = '', location = '' } = {}) {
  const titleNorm = normalizeText(title);
  const kinshasaAtEnd =
    titleNorm.includes('kinshasa') && titleNorm.lastIndexOf('kinshasa') > Math.max(0, titleNorm.length - 50);

  if (kinshasaAtEnd) {
    const fromTitle = detectTargetCity(title.slice(0, titleNorm.lastIndexOf('kinshasa')));
    if (fromTitle && fromTitle !== 'Kinshasa') return fromTitle;
  }

  const fromTitle = detectTargetCity(title);
  if (fromTitle && fromTitle !== 'Kinshasa') return fromTitle;
  if (fromTitle === 'Kinshasa' && !kinshasaAtEnd) return 'Kinshasa';

  const fromDesc = detectTargetCity(description);
  if (fromDesc) return fromDesc;

  const fromAll = detectTargetCity(`${title} ${description} ${location}`);
  if (fromAll) return fromAll;

  if (assessRdcLocation(`${title} ${description} ${location}`, location) === 'rdc_confirme') {
    return 'RDC';
  }
  return 'Non précisé';
}

export function isServiceLogistique(offre = {}) {
  const texte = `${offre.titre || offre.title || ''} ${offre.description || ''} ${offre.organization || ''}`;
  return isServiceOpportunity(texte);
}

export function concernsTargetCity(offre = {}) {
  const texte = `${offre.titre || offre.title || ''} ${offre.description || ''} ${offre.location || ''} ${offre.ville || ''}`;
  const status = assessRdcLocation(texte, offre.location || '');
  return status === 'rdc_confirme';
}

export function mapAiCategoryToSlug(categorie = '') {
  const value = normalizeText(categorie);
  if (!value || value.includes('non pertinent')) return null;
  if (value.includes('chauffeur') || value.includes('conduite')) return 'formation_chauffeurs';
  if (value.includes('formation')) return 'formation';
  if (value.includes('etude') || value.includes('march')) return 'etude_marche';
  if (value.includes('actif')) return 'inventaire_actifs';
  if (value.includes('inventaire')) return 'inventaire_general';
  if (value.includes('consult') || value.includes('assistance') || value.includes('conseil')) return 'consultance';
  return classifyMecalCategory(categorie);
}
