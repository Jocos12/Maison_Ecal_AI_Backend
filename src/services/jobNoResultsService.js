/**
 * Réponses actionnables quand aucune offre n'est trouvée — sans inventer d'offres.
 */
import { callAIForJSON } from './aiService.js';
import { getJobSourceLabel, getManualSearchLinks } from '../config/jobSources.js';
import logger from '../utils/logger.js';

export const MANUAL_SEARCH_LINKS = [
  ...getManualSearchLinks(),
  {
    label: 'Indeed — emplois Kinshasa',
    url: 'https://cd.indeed.com/jobs?q=logistique&l=Kinshasa'
  }
];

function countFailedSources(sources = {}, failedSources = []) {
  if (failedSources.length) return failedSources.length;
  return Object.values(sources).filter((s) => s.status === 'error' || s.status === 'disabled').length;
}

function countOkSources(sources = {}) {
  return Object.values(sources).filter((s) => s.status === 'ok').length;
}

export function diagnoseSearchSituation({
  sources,
  failedSources = [],
  allSourcesFailed,
  sourcesRespondedEmpty,
  rawCount,
  filteredCount
}) {
  if (allSourcesFailed || (countFailedSources(sources, failedSources) > 0 && rawCount === 0 && countOkSources(sources) === 0)) {
    return 'sources_unavailable';
  }
  if (sourcesRespondedEmpty || rawCount === 0) return 'sources_empty';
  if (filteredCount === 0 && rawCount > 0) return 'filter_too_strict';
  return 'no_matches';
}

export function buildSearchSuggestions({ role, city, allRdc, userNeed = '' }) {
  const suggestions = new Set();
  const cities = allRdc || !city
    ? ['Kinshasa', 'Goma', 'Bukavu', 'Lubumbashi']
    : [city];
  const roles = role
    ? [role]
    : ['magasinier', 'assistant logistique', 'chauffeur', 'officier logistique'];

  for (const r of roles) {
    for (const c of cities.slice(0, 3)) {
      suggestions.add(`Cherche ${r} à ${c}`);
    }
  }

  if (allRdc) {
    suggestions.add('logistique toutes villes RDC');
  }

  if (/logist/i.test(userNeed) && !role) {
    suggestions.add('Cherche logistique à Kinshasa');
  }

  return [...suggestions].slice(0, 6);
}

function formatSourceList(sources = {}) {
  return Object.entries(sources)
    .map(([name, info]) => getJobSourceLabel(name))
    .filter(Boolean)
    .join(', ');
}

function buildDeterministicMessage(context) {
  const { diagnosis, sources, failedSources = [], rawCount, city, role, allRdc, broadened } = context;
  const lines = [];
  const sourceLabels = formatSourceList(sources);

  if (diagnosis === 'sources_unavailable') {
    lines.push('**Pourquoi 0 résultat ?** Les sources automatiques n\'ont pas pu être consultées.');
    for (const fail of failedSources) {
      const label = getJobSourceLabel(fail.source);
      lines.push(`• **${label}** : ${fail.reason}`);
    }
    if (!failedSources.length) {
      for (const [name, info] of Object.entries(sources || {})) {
        if (info.message) {
          lines.push(`• **${getJobSourceLabel(name)}** : ${info.message}`);
        }
      }
    }
    lines.push('');
    lines.push('**Solutions immédiates :**');
    lines.push('1. Consultez les **liens directs** ci-dessous (sources officielles vérifiables).');
    lines.push('2. Cliquez sur une **recherche suggérée** pour relancer dès que les sources seront disponibles.');
    lines.push('3. Complétez votre **profil** à droite pour générer un CV en 1 clic quand une offre apparaît.');
    return lines.join('\n');
  }

  if (diagnosis === 'sources_empty') {
    lines.push(
      `**Pourquoi 0 résultat ?** Les sources (${sourceLabels || 'configurées'}) ont répondu correctement mais n'ont renvoyé aucune offre brute pour cette recherche.`
    );
    lines.push('');
    lines.push('**Solutions :**');
    lines.push('1. Élargissez les critères (autre ville, intitulé plus large).');
    lines.push('2. Consultez les liens directs ci-dessous.');
    lines.push('3. Revenez dans quelques jours — de nouvelles offres sont publiées régulièrement.');
    return lines.join('\n');
  }

  if (diagnosis === 'filter_too_strict') {
    lines.push(
      `**${rawCount} offre(s)** récupérée(s) des sources, mais aucune ne correspond exactement à « ${context.userNeed} ».`
    );
    if (broadened) {
      lines.push('J\'ai élargi automatiquement les critères — voir les offres ci-dessous si présentes.');
    } else {
      lines.push('');
      lines.push('**Solutions :**');
      lines.push('1. Essayez un intitulé plus large : « logistique » ou « magasinier » plutôt qu\'un poste très précis.');
      lines.push('2. Testez une autre ville (Kinshasa, Goma et Bukavu concentrent le plus d\'offres ONG).');
      lines.push('3. Cliquez sur une suggestion pour relancer une recherche ciblée.');
    }
    return lines.join('\n');
  }

  const locationLabel = allRdc ? 'toutes les villes de la RDC' : city || 'cette zone';
  const roleLabel = role || 'logistique';
  lines.push(
    `**Résultat :** aucune offre **${roleLabel}** active trouvée pour **${locationLabel}** sur ${sourceLabels || 'les sources configurées'}.`
  );
  lines.push('');
  lines.push('**Ce que je vous recommande :**');
  lines.push('1. **Relancez** avec une suggestion ci-dessous (formulation testée).');
  lines.push('2. **Consultez** les sources via les liens directs — certaines offres ne sont pas indexées instantanément.');
  lines.push('3. **Élargissez** : essayez « assistant logistique » ou « chauffeur » si vous cherchiez un poste très spécifique.');
  lines.push('4. **Préparez** votre CV maintenant (profil à droite) pour candidater dès qu\'une offre sort.');
  lines.push('5. **Revenez** dans 2–3 jours : les ONG publient régulièrement de nouveaux postes en RDC.');

  return lines.join('\n');
}

const GUIDANCE_AI_PROMPT = `Tu aides un chercheur d'emploi logistique en RDC. La recherche automatique n'a trouvé AUCUNE offre vérifiable.
Rédige une réponse UTILE en français (markdown léger avec listes numérotées).
RÈGLES :
- Ne JAMAIS inventer d'offre, organisation, lien d'offre ou date.
- Commence par un diagnostic court (1 phrase) expliquant pourquoi 0 résultat.
- Distingue clairement : sources en panne vs sources OK mais 0 offre correspondante.
- Donne 4 à 5 actions CONCRÈTES et réalisables (reformuler recherche, villes à tester, compléter profil, liens externes génériques).
- Pas de préambule creux ("Après une recherche approfondie...").
- Pas de répétition du message générique "réessayez plus tard" seul.
JSON : { "message": "..." }`;

export async function buildActionableNoResultsResponse(context) {
  const diagnosis = diagnoseSearchSituation(context);
  const suggestions = buildSearchSuggestions(context);
  const manualLinks = MANUAL_SEARCH_LINKS;

  let message = buildDeterministicMessage({ ...context, diagnosis });

  try {
    const { data } = await callAIForJSON(
      `${GUIDANCE_AI_PROMPT}\n\nContexte technique :\n${JSON.stringify(
        {
          diagnosis,
          userNeed: context.userNeed,
          city: context.city,
          role: context.role,
          allRdc: context.allRdc,
          rawCount: context.rawCount,
          allSourcesFailed: context.allSourcesFailed,
          sourcesRespondedEmpty: context.sourcesRespondedEmpty,
          failedSources: context.failedSources,
          sources: context.sources
        },
        null,
        2
      )}`,
      ''
    );
    if (data.message?.length > 80 && !/offre d.?emploi chez|https?:\/\/[^\s]+vacancy/i.test(data.message)) {
      message = data.message;
    }
  } catch (e) {
    logger.warn(`[JobAssistant] Guidance IA: ${e.message}`);
  }

  return {
    message,
    suggestions,
    manualLinks,
    diagnosis,
    noResults: true,
    jobs: []
  };
}
