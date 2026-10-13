import { callAIText } from './aiService.js';
import { explainSkipDetail } from './skipDetailReason.js';

export const SKIP_REASON_LABELS = {
  not_mecal_service: 'Hors services M-ECAL (6 catégories logistiques)',
  ai_rejected: "Rejeté par l'IA (hors périmètre ou emploi)",
  non_logistics: 'Hors logistique (routes, EIES, achats matériel…)',
  job_posting: "Offre d'emploi (exclue de la veille)",
  ai_low_score: 'Score de pertinence IA trop faible',
  hors_rdc: 'Hors République Démocratique du Congo',
  needs_ai_no_keys: 'Analyse IA requise mais aucune clé configurée',
  no_category: 'Catégorie M-ECAL non identifiée',
  ai_no_category: 'Catégorie M-ECAL non identifiée (IA)',
  duplicate: 'Doublon déjà en base',
  missing_fields: 'Titre ou lien source manquant',
  not_a_tender: 'Bulletin / rapport (pas un appel d’offres)',
  unknown: 'Raison inconnue'
};

export function rejectReasonLabel(reasonKey) {
  return SKIP_REASON_LABELS[reasonKey] || reasonKey;
}

export function enrichSkippedOffer(item) {
  const detail = explainSkipDetail(item);
  return {
    title: item.title,
    source: item.source || item.platform || item.organization || 'Inconnue',
    platform: item.platform || item.source || '',
    date: item.date ? new Date(item.date).toLocaleDateString('fr-FR') : '',
    score: item.score,
    rejectReason: detail.text,
    rejectCode: detail.code,
    reasonKey: item.reasonKey,
    description: item.description || '',
    url: item.url || ''
  };
}

export function buildSkipAdviceSystemPrompt({ categoryLabel, count, logDate }) {
  return `Tu es l'assistant IA de M-ECAL (Maison d'Études, Conseil et Assistance Logistique), basé en RDC.

PRIORITÉ ABSOLUE — format de réponse:
1) Commence TOUJOURS par 1 à 2 phrases qui traitent DIRECTEMENT et explicitement la question actuelle de l'utilisateur. Première ligne = réponse utile à CE qui a été demandé, en reprenant les mots-clés de la question (CEO, ReliefWeb, titre d'offre, etc.). Ex. « En tant que CEO, voici comment procéder : … », « ReliefWeb est souvent rejeté parce que … », « Pour l'offre « … » : NON, car … ».
2) N'ouvre JAMAIS par un tableau, un listing « Pourquoi chaque offre a été rejetée », un récapitulatif générique des offres, ni un briefing de tendances.
3) Les offres fournies sont un CONTEXTE. Ne les énumère pas par défaut.
4) Un tableau / analyse offre par offre n'est autorisé QUE si l'utilisateur le demande (détail, tableau, « chaque offre », « une par une », « pourquoi ont-elles été rejetées ») ; sinon tu peux, UNIQUEMENT après la réponse directe, ajouter un court complément sous le titre markdown « Complément (optionnel) » — jamais à la place de la réponse.
5) Si la question porte sur postuler / candidater / CEO / procédure : donne la marche à suivre (ou un NON clair + quoi faire à la place) dès le premier paragraphe. Une ligne « Recommandation finale : OUI / NON / PEUT-ÊTRE » peut clôturer, après la réponse.

Contexte de veille (informatif seulement):
Catégorie: ${categoryLabel}
Nombre d'offres: ${count}
Date de collecte: ${logDate}

Sois direct, pratique et franc. Réponds en français.`;
}

function formatOffersContext(offers = []) {
  if (!offers.length) return 'Aucune offre détaillée enregistrée pour cette catégorie.';
  return offers
    .slice(0, 25)
    .map(
      (o, i) =>
        `${i + 1}. Titre: ${o.title}
   Source: ${o.source || o.platform || 'N/A'}
   Raison précise: ${o.rejectReason || rejectReasonLabel(o.reasonKey)}
   Score: ${o.score != null ? `${o.score}%` : 'non noté (hors périmètre)'}
   URL: ${o.url || 'N/A'}
   Description: ${(o.description || '').slice(0, 280)}`
    )
    .join('\n\n');
}

export async function getSkipCategoryInsights({ categoryLabel, count, logDate, offers = [] }) {
  const byCode = {};
  const bySource = {};
  for (const o of offers) {
    const code = o.rejectCode || 'generic';
    byCode[code] = (byCode[code] || 0) + 1;
    const src = o.source || o.platform || 'Inconnue';
    bySource[src] = (bySource[src] || 0) + 1;
  }
  const codes = Object.entries(byCode)
    .sort((a, b) => b[1] - a[1])
    .map(([k, n]) => `${k}: ${n}`)
    .join(', ');
  const sources = Object.entries(bySource)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 8)
    .map(([k, n]) => `${k}: ${n}`)
    .join(', ');

  const systemPrompt = `Tu es l'analyste de veille de Maison ECAL (firme logistique RDC).
Rédige en français un briefing court (pas de liste recopiée des titres).
Structure obligatoire:
1) Tendances — 3 à 5 phrases sur la composition des rejets (sources, types: emplois vs marchés vs fournitures, etc.).
2) Suggestion concrète — une action pour l'équipe (ajuster une source, ne pas relâcher un filtre, surveiller un cas limite).
Sois factuel. N'invente pas de chiffres hors de ceux fournis.`;

  const prompt = `Catégorie: ${categoryLabel}
Volume: ${count} offres rejetées (échantillon détaillé: ${offers.length})
Collecte: ${logDate}
Répartition des raisons précises: ${codes || 'n/d'}
Répartition des sources: ${sources || 'n/d'}

Exemples (max 12):
${formatOffersContext(offers.slice(0, 12))}`;

  const text = await callAIText(prompt, systemPrompt, 900);
  return { reply: text };
}

export async function getSkipCategoryAdvice({
  categoryLabel,
  count,
  logDate,
  offers = [],
  userMessage,
  history = []
}) {
  const systemPrompt = buildSkipAdviceSystemPrompt({ categoryLabel, count, logDate });
  const offersBlock = formatOffersContext(offers);

  const historyText = history
    .slice(-12)
    .map((m) => `${m.role === 'user' ? 'Utilisateur' : 'Assistant'}: ${m.content}`)
    .join('\n');

  const prompt = `Contexte — offres rejetées (ne les liste pas sauf si la question le demande):
${offersBlock}

${historyText ? `Historique de conversation:\n${historyText}\n\n` : ''}QUESTION ACTUELLE — réponds d'abord à ça, en 1-2 phrases en tête, avant tout autre développement:
${userMessage}`;

  const text = await callAIText(prompt, systemPrompt, 2200);
  return { reply: text };
}
