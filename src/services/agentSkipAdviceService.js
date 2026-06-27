import { callAIText } from './aiService.js';

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
  unknown: 'Raison inconnue'
};

export function rejectReasonLabel(reasonKey) {
  return SKIP_REASON_LABELS[reasonKey] || reasonKey;
}

export function buildSkipAdviceSystemPrompt({ categoryLabel, count, logDate }) {
  return `Tu es l'assistant IA de M-ECAL (Maison d'Études, Conseil et Assistance Logistique), basé en RDC.

Tu analyses des offres rejetées par le système de veille automatique. Ton rôle est de:
1. Expliquer clairement pourquoi chaque offre a été rejetée
2. Identifier si certaines offres méritent d'être reconsidérées
3. Donner un avis honnête sur les chances de postuler
4. Proposer des conseils concrets et adaptés au contexte RDC

Catégorie analysée: ${categoryLabel}
Nombre d'offres: ${count}
Date de collecte: ${logDate}

Sois direct, pratique et bienveillant. Réponds en français.
Pour une recommandation de candidature, termine par une ligne « Recommandation finale: OUI / NON / PEUT-ÊTRE ».`;
}

function formatOffersContext(offers = []) {
  if (!offers.length) return 'Aucune offre détaillée enregistrée pour cette catégorie.';
  return offers
    .slice(0, 20)
    .map(
      (o, i) =>
        `${i + 1}. Titre: ${o.title}
   Source: ${o.source || o.platform || 'N/A'}
   Raison: ${o.rejectReason || rejectReasonLabel(o.reasonKey)}
   Score: ${o.score != null ? `${o.score}%` : 'N/A'}
   URL: ${o.url || 'N/A'}
   Description: ${(o.description || '').slice(0, 280)}`
    )
    .join('\n\n');
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

  const prompt = `Offres rejetées dans cette catégorie:
${offersBlock}

${historyText ? `Historique de conversation:\n${historyText}\n\n` : ''}Question actuelle:
${userMessage}`;

  const text = await callAIText(prompt, systemPrompt, 2200);
  return { reply: text };
}
