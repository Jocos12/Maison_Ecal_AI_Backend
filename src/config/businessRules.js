export const SERVICES_INCLUS = [
  'formation logistique',
  'formation procédures logistiques',
  'formation procedures logistiques',
  'formation chauffeur',
  'conduite véhicule',
  'conduite vehicule',
  'formation conducteur',
  'étude de marché',
  'etude de marche',
  'étude marché',
  'etude marche',
  'market study',
  'inventaire actifs',
  "inventaire d'actifs",
  'inventaire général',
  'inventaire general',
  'asset inventory',
  'consultance logistique',
  'conseil logistique',
  'assistance logistique',
  'logistic consultancy',
  'logistics consultancy',
  'logistic training',
  'logistics training',
  'logistics consulting',
  'appel à consultants',
  'appel a consultants',
  'appel d offres logistique',
  "appel d'offres logistique",
  'prestation logistique',
  'service logistique'
];

export const EMPLOIS_EXCLUS = [
  'magasinier',
  'assistant logistique',
  'officier logistique',
  'manager logistique',
  'logistics manager',
  'logistics officer',
  'logistics assistant',
  'warehouse',
  'storekeeper',
  'offre d emploi',
  "offre d'emploi",
  'job vacancy',
  'recruitment',
  'recrutement',
  'nous recrutons',
  'avis de recrutement',
  'poste vacant',
  'cherche candidat',
  'cv attendu',
  'envoyer votre cv',
  'emploi',
  'vacancy',
  'job',
  'hiring',
  'internship',
  'stagiaire'
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
  'Congo',
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
  'Formation des chauffeurs / conduite de véhicules',
  'Étude de marchés',
  "Inventaire d'Actifs d'une Organisation",
  "Inventaire général d'une Organisation",
  'Consultance logistique, Assistance et Conseils'
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

export function detectTargetCity(input = '') {
  const text = normalizeText(input);
  const canonical = ['Bukavu', 'Goma', 'Kinshasa', 'Kalemie', 'Lubumbashi'];
  for (const city of canonical) {
    if (text.includes(normalizeText(city))) return city;
  }
  if (/(sud-kivu|sud kivu)/.test(text)) return 'Bukavu';
  if (/(nord-kivu|nord kivu)/.test(text)) return 'Goma';
  if (/(haut-katanga|katanga)/.test(text)) return 'Lubumbashi';
  if (/(rdc|drc|congo|republique democratique|democratic republic)/.test(text)) return 'RDC';
  return null;
}

export function isServiceLogistique(offre = {}) {
  const texte = `${offre.titre || offre.title || ''} ${offre.description || ''} ${offre.organization || ''}`;
  const estUnEmploi = includesAny(texte, EMPLOIS_EXCLUS);
  if (estUnEmploi) return false;
  return includesAny(texte, SERVICES_INCLUS);
}

export function concernsTargetCity(offre = {}) {
  const texte = `${offre.titre || offre.title || ''} ${offre.description || ''} ${offre.location || ''} ${offre.ville || ''}`;
  return Boolean(detectTargetCity(texte));
}
