import axios from 'axios';
import logger from '../utils/logger.js';
import { callClaudeJson, callClaudeText } from './anthropicService.js';
import {
  SERVICES_MECAL,
  NON_LOGISTICS_EXCLUSIONS,
  assessRdcLocation,
  classifyMecalCategory,
  detectTargetCity,
  includesAny,
  isJobPosting,
  isServiceOpportunity,
  mapAiCategoryToSlug,
  resolveVille
} from '../config/businessRules.js';

const CATEGORY_LABELS = {
  formation: SERVICES_MECAL[0],
  formation_chauffeurs: SERVICES_MECAL[1],
  etude_marche: SERVICES_MECAL[2],
  inventaire_actifs: SERVICES_MECAL[3],
  inventaire_general: SERVICES_MECAL[4],
  consultance: SERVICES_MECAL[5]
};

const MECAL_SYSTEM_PROMPT = `Tu es un agent de veille spécialisé dans les SERVICES logistiques en République Démocratique du Congo (RDC) uniquement.

Ta mission : identifier UNIQUEMENT des opportunités correspondant à l'une de ces 6 catégories de SERVICES (jamais de postes à pourvoir) :
1. Formations procédures logistiques
2. Formation chauffeurs / conduite de véhicules
3. Étude de marchés (commercial / logistique — PAS étude d'impact environnemental EIES/ESIA)
4. Inventaire d'Actifs d'une Organisation
5. Inventaire général d'une Organisation
6. Consultance, Assistance et Conseils en logistique (supply chain, stocks, entrepôts, distribution)

RÈGLES D'EXCLUSION (rejette systématiquement — categorie = "non pertinent") :
- Toute offre d'emploi/recrutement de personnel : magasinier, assistant logistique, officier logistique, manager logistique, spécialiste, expert individuel salarié, CDI, CDD, h/f, CV.
- Travaux routiers, surveillance de chantiers, génie civil, assainissement, eau/santé, audits techniques généraux, cybersécurité, achats de véhicules/mobiliers/informatique.
- Études environnementales (EIES, ESIA) — ce ne sont PAS des études de marché logistique.
- Toute opportunité hors RDC (ne pas confondre RDC avec Congo-Brazzaville).

RÈGLES D'INCLUSION :
- Appels d'offres, TDR, RFP/RFQ, missions de prestation logistique correspondant aux 6 catégories ci-dessus.
- Pour ville_confirmee : indique Bukavu, Goma, Kinshasa, Kalemie, Lubumbashi si mention explicite dans le titre/lieu du projet ; sinon "RDC" pour un marché national ; "Non précisé" si inconnu. Ne mets pas Kinshasa par défaut.

Si type = "offre_emploi" OU hors périmètre logistique OU pays_confirme_rdc = false → categorie = "non pertinent".`;

function normalizeAiAnalysis(raw = {}, texte = '') {
  const type = raw.type || (raw.est_emploi ? 'offre_emploi' : raw.est_service ? 'service' : 'autre');
  const pays =
    raw.pays_confirme_rdc === true || raw.pays_confirme_rdc === 'true'
      ? 'true'
      : raw.pays_confirme_rdc === false || raw.pays_confirme_rdc === 'false'
        ? 'false'
        : 'a_verifier';

  const estEmploi = type === 'offre_emploi' || Boolean(raw.est_emploi) || isJobPosting(texte);
  const heuristicCategory = classifyMecalCategory(texte);
  const estService =
    !estEmploi &&
    (type === 'service' || Boolean(raw.est_service) || heuristicCategory !== null) &&
    !includesAny(texte, NON_LOGISTICS_EXCLUSIONS);
  const categorie =
    estEmploi || pays === 'false' || String(raw.categorie || '').toLowerCase().includes('non pertinent') || !estService
      ? 'non pertinent'
      : raw.categorie || CATEGORY_LABELS[heuristicCategory] || 'non pertinent';

  return {
    est_service: estService,
    est_emploi: estEmploi,
    type,
    score: Number(raw.score || 0),
    categorie,
    pays_confirme_rdc: pays,
    justification: raw.justification || raw.raison || '',
    recommandation: raw.recommandation || (estService && pays !== 'false' ? 'EVALUER' : 'IGNORER'),
    raison: raw.raison || raw.justification || '',
    ville_confirmee: raw.ville_confirmee || detectTargetCity(texte) || 'Non précisé',
    points_forts: raw.points_forts || [],
    action_suggeree: raw.action_suggeree || 'Envoyer proposition commerciale'
  };
}

function hasAnyAIProvider() {
  return Boolean(process.env.ANTHROPIC_API_KEY || process.env.GROQ_API_KEY || process.env.GEMINI_API_KEY);
}

/**
 * Optional LLM pass: scores 0–1 logistics-service relevance for DRC.
 * If OPENAI_API_KEY is missing, returns null (caller uses heuristics only).
 */
export async function scoreRelevanceWithAI({ title, description, organization }) {
  if (hasAnyAIProvider()) {
    const analysis = await analyzeOpportunityForMecal({ title, description, organization });
    if (
      analysis.est_emploi ||
      !analysis.est_service ||
      analysis.pays_confirme_rdc === 'false' ||
      analysis.categorie === 'non pertinent'
    ) {
      return 0;
    }
    return Math.min(1, Math.max(0, Number(analysis.score || 0) / 100));
  }
  const key = process.env.OPENAI_API_KEY;
  if (!key) return null;
  const model = process.env.OPENAI_MODEL || 'gpt-4o-mini';
  const prompt = `You classify procurement/service notices for a logistics consultancy in DRC ONLY.
Return ONLY JSON:
{
  "score": number between 0 and 1,
  "is_service_not_job": boolean,
  "type": "service" | "offre_emploi" | "autre",
  "pays_confirme_rdc": true | false | "a_verifier"
}
Reject staff job vacancies (Magasinier, Assistant Logistique, Manager Logistique, CDI/CDD, recruitment).
Reject anything outside Democratic Republic of Congo (not Congo-Brazzaville).
Score high only for logistics training, consultancy, inventory, market study, assistance — as external service contracts.
Title: ${title}
Org: ${organization}
Text: ${(description || '').slice(0, 4000)}`;

  try {
    const { data } = await axios.post(
      'https://api.openai.com/v1/chat/completions',
      {
        model,
        messages: [
          { role: 'system', content: 'Reply with compact JSON only.' },
          { role: 'user', content: prompt }
        ],
        temperature: 0.2
      },
      {
        headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
        timeout: 45000
      }
    );
    const raw = data?.choices?.[0]?.message?.content?.trim() || '{}';
    const parsed = JSON.parse(raw.replace(/^```json\s*|```$/g, ''));
    const score = Math.min(1, Math.max(0, Number(parsed.score) || 0));
    if (parsed.is_service_not_job === false && score > 0.4) {
      return Math.min(score, 0.35);
    }
    return score;
  } catch (e) {
    logger.warn(`AI classifier skipped: ${e.message}`);
    return null;
  }
}

export async function analyzeOpportunityForMecal({ title, description, organization, ville, location = '' }) {
  const texte = `${title} ${description} ${organization} ${ville || ''} ${location || ''}`;
  const locationStatus = assessRdcLocation(texte, location);
  const heuristicCategory = classifyMecalCategory(texte);
  const fallback = normalizeAiAnalysis(
    {
      est_service: heuristicCategory !== null,
      est_emploi: isJobPosting(texte),
      type: isJobPosting(texte) ? 'offre_emploi' : heuristicCategory ? 'service' : 'autre',
      score: heuristicCategory && locationStatus !== 'hors_rdc' ? 75 : 0,
      categorie: heuristicCategory ? CATEGORY_LABELS[heuristicCategory] : 'non pertinent',
      pays_confirme_rdc: locationStatus === 'rdc_confirme' ? 'true' : locationStatus === 'hors_rdc' ? 'false' : 'a_verifier',
      justification: 'Analyse heuristique locale (services logistiques M-ECAL uniquement).',
      recommandation: heuristicCategory && locationStatus !== 'hors_rdc' ? 'EVALUER' : 'IGNORER',
      ville_confirmee: resolveVille({ title, description, location }),
      points_forts: heuristicCategory ? ['Correspondance catégorie logistique M-ECAL'] : [],
      action_suggeree: 'Envoyer proposition commerciale'
    },
    texte
  );

  const prompt = `${MECAL_SYSTEM_PROMPT}

Analyse cette offre :
Titre : ${title}
Description : ${(description || '').slice(0, 5000)}
Organisation : ${organization || 'Non précisé'}
Ville / localisation : ${ville || location || 'Non précisé'}

Réponds UNIQUEMENT en JSON :
{
  "est_service": true,
  "est_emploi": false,
  "type": "service",
  "score": 0,
  "categorie": "Formations procédures logistiques|Formation chauffeurs / conduite de véhicules|Étude de marchés|Inventaire d'Actifs d'une Organisation|Inventaire général d'une Organisation|Consultance, Assistance et Conseils en logistique|non pertinent",
  "pays_confirme_rdc": true,
  "justification": "courte explication",
  "recommandation": "POSTULER|EVALUER|IGNORER",
  "raison": "courte explication",
  "ville_confirmee": "Goma|Bukavu|Kinshasa|Kalemie|Lubumbashi|RDC|Non précisé",
  "points_forts": ["...", "..."],
  "action_suggeree": "Envoyer proposition commerciale|Lettre de motivation|..."
}`;

  const raw = await callClaudeJson(prompt, fallback);
  return normalizeAiAnalysis(raw, texte);
}

export async function generateMotivationLetter(opp, profile = {}) {
  const fallback = `Madame, Monsieur,\n\nLa Maison d'Études, de Conseil et d'Assistance Logistique (M-ECAL) vous adresse sa manifestation d'intérêt pour ${opp.title} à ${opp.ville || opp.location || 'RDC'}.\n\nNotre équipe accompagne les organisations en RDC dans les formations logistiques, la formation des chauffeurs, les études de marchés, les inventaires d'actifs et la consultance logistique.\n\nNous serions honorés d'échanger avec ${opp.organization || 'votre organisation'} afin de préciser votre besoin et de proposer une approche adaptée.\n\nDirection M-ECAL\nmaisonecal@gmail.com`;
  const prompt = `Rédige une lettre de motivation professionnelle en français pour M-ECAL.

PROFIL M-ECAL :
- Nom : ${profile.companyName || "Maison d'Études, de Conseil et d'Assistance Logistique"}
- Spécialité : Services logistiques en RDC
- Services : ${SERVICES_MECAL.join(', ')}
- Email : ${profile.email || 'maisonecal@gmail.com'}
- Zones : ${(profile.cities || ['Kinshasa', 'Goma', 'Bukavu', 'Lubumbashi', 'Kalemie']).join(', ')}

OFFRE CIBLE :
- Titre : ${opp.title}
- Organisation : ${opp.organization || 'Non précisé'}
- Description : ${(opp.description || '').slice(0, 5000)}
- Ville : ${opp.ville || opp.location || 'Non précisé'}
- Deadline : ${opp.deadline || 'Non précisé'}

La lettre doit être adressée à l'organisation, montrer pourquoi M-ECAL est qualifié, mentionner la ville, rester sous 400 mots, finir par une invitation à discuter, signature : Direction M-ECAL, ${profile.email || 'maisonecal@gmail.com'}.`;
  return callClaudeText(prompt, fallback);
}

export async function generateCommercialProposal(opp, profile = {}) {
  const fallback = `# Proposition commerciale M-ECAL\n\n## Résumé exécutif\nM-ECAL propose une intervention adaptée à ${opp.title}.\n\n## Compréhension du besoin\nL'opportunité concerne ${opp.category} à ${opp.ville || opp.location || 'RDC'}.\n\n## Notre approche\nDiagnostic, planification, exécution terrain, restitution.\n\n## Chronogramme\nSemaine 1: cadrage. Semaines 2-3: exécution. Semaine 4: rapport final.\n\n## Budget indicatif\nÀ préciser après échange technique.\n\n## Contacts\nDirection M-ECAL - ${profile.email || 'maisonecal@gmail.com'}`;
  const prompt = `Génère une proposition commerciale complète en français pour M-ECAL au format Markdown avec ces sections :
1. Page de garde M-ECAL
2. Résumé exécutif
3. Compréhension du besoin
4. Notre approche basée sur la catégorie ${opp.category}
5. Chronogramme
6. Budget indicatif
7. Références M-ECAL
8. Conclusion + contacts

Offre : ${opp.title}
Organisation : ${opp.organization || 'Non précisé'}
Description : ${(opp.description || '').slice(0, 5000)}
Ville : ${opp.ville || opp.location || 'Non précisé'}
Email contact : ${profile.email || 'maisonecal@gmail.com'}`;
  return callClaudeText(prompt, fallback);
}

function cleanEmailText(value = '') {
  return String(value)
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function latestClientMessage(value = '') {
  const text = cleanEmailText(value)
    .replace(/\s+(On\s.+?\swrote:)/gi, '\n$1')
    .replace(/\s+(Le\s.+?\sa écrit\s*:)/gi, '\n$1');
  const firstThreadMarker = text.search(/\b(On\s.+?\swrote:|Le\s.+?\sa écrit\s*:)/i);
  const latest = firstThreadMarker >= 0 ? text.slice(0, firstThreadMarker) : text;
  return latest
    .replace(/^>+\s?/gm, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function detectIntent(text = '') {
  const lower = text.toLowerCase();
  if (lower.includes('devis') || lower.includes('prix') || lower.includes('combien')) return 'Envoyer devis';
  if (lower.includes('service') || lower.includes('parler') || lower.includes('besoin') || lower.includes('information')) return 'Présenter les services';
  if (lower.includes('rendez') || lower.includes('appel') || lower.includes('meeting')) return 'Proposer RDV';
  return 'Demander détails';
}

export async function suggestEmailReplies({ from, senderName, subject, body, snippet, receivedAt, category }) {
  const rawMessage = body || snippet || '';
  const message = latestClientMessage(rawMessage) || cleanEmailText(rawMessage);
  const action = detectIntent(`${subject || ''} ${message}`);
  const name = senderName || from || 'Monsieur/Madame';
  const fallback = {
    analyse_client: `Le client ${name} demande une réponse concernant : ${subject || message.slice(0, 120) || 'son message'}.`,
    reponse_courte: `Bonjour ${name},\n\nMerci pour votre message. Concernant votre demande${message ? ` (« ${message.slice(0, 120)} »)` : ''}, M-ECAL peut vous présenter clairement ses services logistiques et voir avec vous l’accompagnement le plus adapté.\n\nCordialement,\nM-ECAL`,
    reponse_complete: `Bonjour ${name},\n\nMerci pour votre message. Vous souhaitez ${message || 'obtenir des informations'}.\n\nM-ECAL accompagne ses clients en RDC dans la consultance logistique, les formations, les études, les inventaires et l’appui opérationnel. Nous pouvons vous expliquer nos services et identifier ceux qui correspondent le mieux à votre besoin.\n\nPour avancer efficacement, nous pouvons organiser un court échange afin de préciser votre contexte, la ville concernée, le délai souhaité et le type d’accompagnement attendu.\n\nCordialement,\nDirection M-ECAL`,
    ton: 'formel',
    action_suggeree: action,
    source: 'fallback_local'
  };
  const prompt = `Tu es l'Agent IA de M-ECAL, entreprise de services logistiques en RDC.
Tu dois lire et comprendre le message client avant de rédiger. Ne donne jamais une réponse générique.

Profil M-ECAL :
- Services : formations logistiques, études de marchés, inventaires, assistance technique, consultance, appui opérationnel.
- Zones : Kinshasa, Goma, Bukavu, Lubumbashi, Kalemie et autres villes RDC selon projet.
- Ton : professionnel, chaleureux, clair, orienté solution.

Email reçu :
De : ${from}
Nom affiché : ${senderName || 'Non précisé'}
Date : ${receivedAt || 'Non précisée'}
Catégorie : ${category || 'Non précisée'}
Sujet : ${subject || '(Sans objet)'}
Message client complet :
"""${message.slice(0, 7000)}"""

Historique complet reçu (pour contexte seulement, ne pas répondre aux messages M-ECAL cités) :
"""${cleanEmailText(rawMessage).slice(0, 9000)}"""

Tâche :
1. Analyse concrètement ce que le client demande.
2. Identifie l'intention principale et les informations manquantes.
3. Rédige une réponse courte et une réponse complète en français.
4. La réponse doit citer le besoin du client avec ses propres éléments (ex: maison ecal, services, devis, rendez-vous, mission, etc.).
5. Si le message est une demande simple, réponds directement sans exagérer.
6. Si le client demande des services, propose un échange ou les prochaines informations utiles.

Réponds uniquement en JSON valide :
{
  "analyse_client": "résumé précis de la demande du client en 1 phrase",
  "reponse_courte": "...",
  "reponse_complete": "...",
  "ton": "formel",
  "action_suggeree": "Présenter les services|Prendre RDV|Envoyer devis|Demander détails|Répondre directement",
  "source": "claude"
}`;
  return callClaudeJson(prompt, fallback);
}

export async function generateMarketingSuggestions(stats = {}) {
  const fallback = [
    {
      suggestion: 'Publier chaque semaine une étude de cas logistique RDC sur LinkedIn.',
      priorite: 'Haute',
      effort: 'Moyen',
      impact: 'Élevé',
      exemple_concret: 'Post LinkedIn: 5 erreurs fréquentes dans les inventaires d’actifs en RDC.'
    }
  ];
  const prompt = `Expert marketing B2B pour services logistiques en Afrique centrale.
M-ECAL opère en RDC. Services : ${SERVICES_MECAL.join(', ')}.
Données actuelles : ${JSON.stringify(stats)}
Génère 5 suggestions concrètes pour la visibilité, opportunités gagnées, taux de réponse, nouveaux clients et stratégie contenu.
Réponds uniquement en JSON array avec {suggestion, priorité, effort, impact, exemple_concret}.`;
  return callClaudeJson(prompt, fallback);
}
