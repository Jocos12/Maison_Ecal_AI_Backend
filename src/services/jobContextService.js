const RDC_CITIES = [
  'kinshasa',
  'lubumbashi',
  'goma',
  'bukavu',
  'kalemie',
  'kisangani',
  'kananga',
  'mbuji-mayi',
  'matadi',
  'kolwezi'
];

const JOB_ROLES = [
  'magasinier',
  'chauffeur',
  'logistique',
  'logistics',
  'logistoque',
  'officier logistique',
  'assistant logistique',
  'manager logistique',
  'responsable logistique',
  'coordinateur logistique',
  'entrepot',
  'entrepôt',
  'warehouse',
  'supply chain'
];

const SEARCH_INTENT =
  /recherche|trouve|offre|emploi|poste|magasinier|logistique|logistoque|kinshasa|lubumbashi|goma|bukavu|kalemie|recrute|cherche|vacance|hiring|verifie|vérifie|service/i;

const REFINE_INTENT =
  /^(et |aussi |pour un |pour une |dans |à |et pour|plutôt|autre ville|autre poste|verifie|vérifie)/i;

const ALL_RDC_INTENT =
  /toutes les villes|toute la rdc|toutes villes|partout en rdc|dans tout le pays|dans toutes les villes|whole country|all cities|pays entier/i;

function capitalizeCity(name) {
  return name
    .split('-')
    .map((p) => p.charAt(0).toUpperCase() + p.slice(1))
    .join('-');
}

function normalizeTypos(text = '') {
  return text.replace(/logistoque/gi, 'logistique');
}

function findLastCityInTexts(texts) {
  for (let i = texts.length - 1; i >= 0; i--) {
    const lower = normalizeTypos(texts[i]).toLowerCase();
    for (const city of RDC_CITIES) {
      if (lower.includes(city)) return capitalizeCity(city);
    }
  }
  return null;
}

function findLastRoleInTexts(texts) {
  for (let i = texts.length - 1; i >= 0; i--) {
    const lower = normalizeTypos(texts[i]).toLowerCase();
    for (const role of JOB_ROLES) {
      const normalized = role === 'logistoque' ? 'logistique' : role;
      if (lower.includes(role)) return normalized;
    }
  }
  return null;
}

export function isAllRdcSearch(userMessage, priorUserMessages = []) {
  const texts = [...priorUserMessages, userMessage];
  return texts.some((t) => ALL_RDC_INTENT.test(normalizeTypos(t)));
}

export function shouldRunSearch(userMessage, messages = []) {
  const text = normalizeTypos(userMessage.trim());
  if (SEARCH_INTENT.test(text)) return true;
  if (ALL_RDC_INTENT.test(text)) return true;

  const hadPriorSearch = messages.some(
    (m) => m.role === 'assistant' && (m.jobs?.length > 0 || m.noResults === true)
  );

  if (hadPriorSearch && REFINE_INTENT.test(text)) return true;
  if (hadPriorSearch && ALL_RDC_INTENT.test(text)) return true;
  if (hadPriorSearch && JOB_ROLES.some((r) => text.toLowerCase().includes(r))) return true;
  if (hadPriorSearch && RDC_CITIES.some((c) => text.toLowerCase().includes(c))) return true;

  return false;
}

export function extractSearchParams(messages = [], userMessage = '') {
  const normalizedMessage = normalizeTypos(userMessage);
  const userTexts = [
    ...messages.filter((m) => m.role === 'user').map((m) => normalizeTypos(m.content)),
    normalizedMessage
  ];

  const allRdc = isAllRdcSearch(
    normalizedMessage,
    messages.filter((m) => m.role === 'user').map((m) => m.content)
  );

  const city = allRdc ? null : findLastCityInTexts(userTexts);
  const role = findLastRoleInTexts(userTexts);

  const queryParts = [role, allRdc ? 'RDC' : city, normalizedMessage].filter(Boolean);
  const query = queryParts.join(' ').trim() || normalizedMessage;

  return { query, city, role, allRdc, broadenSearch: allRdc };
}

export function isClarificationOnly(userMessage) {
  const text = normalizeTypos(userMessage.trim().toLowerCase());
  return (
    /^(dans quelle ville|quelle ville|où |ou |c'est où|precise|précise)/i.test(text) &&
    !SEARCH_INTENT.test(text) &&
    !JOB_ROLES.some((r) => text.includes(r))
  );
}
