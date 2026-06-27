import Application from '../models/Application.js';
import { callClaudeJson } from './anthropicService.js';
import { callAIText } from './aiService.js';

const MARKETING_SYSTEM =
  'Tu es un expert marketing B2B spécialisé dans le secteur logistique en RDC pour M-ECAL. Réponds en français, avec des chiffres concrets tirés des données fournies.';

const TEMPLATE_LABELS = {
  cold_outreach: 'Cold outreach — Présentation M-ECAL',
  followup_j7: 'Suivi candidature J+7',
  followup_j14: 'Relance sans réponse J+14',
  collaboration_b2b: 'Proposition de collaboration B2B',
  newsletter: 'Newsletter mensuelle logistique RDC',
  post_interview: 'Email post-entretien'
};

export function getMatchScore(app) {
  const opp = app.opportunity;
  if (!opp) return 0;
  if (opp.aiAnalysis?.score != null) return Math.round(Number(opp.aiAnalysis.score));
  if (opp.aiRelevanceScore != null) return Math.round(Number(opp.aiRelevanceScore) * 100);
  return 0;
}

export function isAnswered(status) {
  return ['interview', 'won', 'rejected'].includes(status);
}

export function isPending(status) {
  return ['pending', 'submitted'].includes(status);
}

export function isApplied(status) {
  return status !== 'draft';
}

function daysSince(date) {
  if (!date) return 0;
  return Math.floor((Date.now() - new Date(date).getTime()) / 86400000);
}

function groupBy(items, keyFn) {
  return items.reduce((acc, item) => {
    const key = keyFn(item);
    acc[key] = (acc[key] || 0) + 1;
    return acc;
  }, {});
}

export function buildMarketingStats(applications = []) {
  const applied = applications.filter((a) => isApplied(a.status));
  const answered = applied.filter((a) => isAnswered(a.status));
  const pending = applied.filter((a) => isPending(a.status));
  const scores = applied.map(getMatchScore).filter((s) => s > 0);
  const avgScore = scores.length
    ? Math.round(scores.reduce((sum, score) => sum + score, 0) / scores.length)
    : 0;

  const pendingDays = pending.map((a) => daysSince(a.appliedDate || a.createdAt));
  const avgPendingDays = pendingDays.length
    ? Math.round(pendingDays.reduce((sum, d) => sum + d, 0) / pendingDays.length)
    : 0;

  const now = new Date();
  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
  const prevMonthStart = new Date(now.getFullYear(), now.getMonth() - 1, 1);
  const prevMonthEnd = new Date(now.getFullYear(), now.getMonth(), 0, 23, 59, 59);

  const thisMonth = applied.filter((a) => new Date(a.createdAt) >= monthStart);
  const lastMonth = applied.filter((a) => {
    const d = new Date(a.createdAt);
    return d >= prevMonthStart && d <= prevMonthEnd;
  });

  const avgThisMonth = thisMonth.length
    ? Math.round(thisMonth.map(getMatchScore).reduce((s, x) => s + x, 0) / thisMonth.length)
    : avgScore;
  const avgLastMonth = lastMonth.length
    ? Math.round(lastMonth.map(getMatchScore).reduce((s, x) => s + x, 0) / lastMonth.length)
    : avgScore;
  const scoreEvolution = avgScore - avgLastMonth;

  const enriched = applied.map((a) => ({
    source: a.opportunity?.platform || 'M-ECAL',
    category: a.opportunity?.category || a.opportunity?.aiAnalysis?.categorie || '—',
    matchScore: getMatchScore(a),
    status: a.status,
    createdAt: a.createdAt,
    appliedDate: a.appliedDate
  }));

  return {
    total: applied.length,
    answered: answered.length,
    answerRate: applied.length ? Math.round((answered.length / applied.length) * 100) : 0,
    pending: pending.length,
    avgPendingDays,
    avgScore,
    scoreEvolution,
    bySource: groupBy(enriched, (a) => a.source),
    byCategory: groupBy(enriched, (a) => a.category),
    noFollowUp: applied.filter(
      (a) => isPending(a.status) && daysSince(a.appliedDate || a.createdAt) > 7
    ).length
  };
}

export function buildWeeklyChart(applications = []) {
  const applied = applications.filter((a) => isApplied(a.status));
  const weeks = [];

  for (let i = 5; i >= 0; i -= 1) {
    const end = new Date();
    end.setHours(23, 59, 59, 999);
    end.setDate(end.getDate() - i * 7);
    const start = new Date(end);
    start.setDate(start.getDate() - 6);
    start.setHours(0, 0, 0, 0);
    weeks.push({ start, end, week: `S${6 - i}` });
  }

  return weeks.map(({ start, end, week }) => {
    const inRange = applied.filter((a) => {
      const d = new Date(a.appliedDate || a.createdAt);
      return d >= start && d <= end;
    });
    return {
      week,
      soumises: inRange.length,
      repondues: inRange.filter((a) => isAnswered(a.status)).length
    };
  });
}

const FALLBACK_CONSEILS = [
  {
    priorite: 'haute',
    titre: 'Relancer les candidatures sans réponse',
    conseil:
      'Plusieurs candidatures sont en attente depuis plus de 7 jours. Un email de suivi J+7 peut augmenter le taux de réponse de 20 à 35 % en B2B logistique.',
    action: 'Générer email de relance',
    prompt:
      'Rédige un email de relance professionnel J+7 pour une candidature logistique M-ECAL en RDC, ton courtois, 150 mots max, objet inclus.'
  },
  {
    priorite: 'moyenne',
    titre: 'Renforcer la visibilité LinkedIn',
    conseil:
      'Publiez une étude de cas hebdomadaire sur vos missions d’inventaire et de consultance logistique en RDC pour attirer des appels d’offres qualifiés.',
    action: 'Générer post LinkedIn',
    prompt:
      'Rédige un post LinkedIn B2B pour M-ECAL sur une mission d’inventaire logistique en RDC, avec hook, 3 points clés et CTA.'
  },
  {
    priorite: 'opportunite',
    titre: 'Cibler les sources les plus performantes',
    conseil:
      'Concentrez vos prochaines candidatures sur les plateformes où votre score de matching est le plus élevé pour optimiser le ROI de prospection.',
    action: 'Générer plan de sourcing',
    prompt:
      'Propose un plan de sourcing sur 2 semaines pour M-ECAL en RDC basé sur les plateformes ReliefWeb, UNjobs et Coordination Sud.'
  }
];

function normalizeConseils(raw) {
  const list = raw?.conseils || raw?.suggestions || (Array.isArray(raw) ? raw : []);
  if (!Array.isArray(list) || !list.length) return FALLBACK_CONSEILS;
  return list.slice(0, 5).map((c) => ({
    priorite: String(c.priorite || c.priorité || 'moyenne').toLowerCase(),
    titre: c.titre || c.title || 'Conseil marketing',
    conseil: c.conseil || c.suggestion || c.description || '',
    action: c.action || 'Générer contenu',
    prompt: c.prompt || c.conseil || ''
  }));
}

export async function analyzeOpportunities(stats = {}) {
  const prompt = `Tu es un expert marketing B2B spécialisé dans le secteur logistique en RDC.
Analyse ces données de candidatures M-ECAL et génère exactement 3 conseils marketing actionnables.

Données: ${JSON.stringify(stats)}

Réponds UNIQUEMENT en JSON valide sans backticks ni markdown :
{
  "conseils": [
    {
      "priorite": "haute|moyenne|opportunite",
      "titre": "...",
      "conseil": "conseil précis avec chiffres réels des données...",
      "action": "texte du bouton action",
      "prompt": "prompt pour générer le contenu marketing associé"
    }
  ]
}`;

  const raw = await callClaudeJson(prompt, { conseils: FALLBACK_CONSEILS });
  return normalizeConseils(raw);
}

export async function askMarketingQuestion(stats, question, history = []) {
  const historyText = history
    .slice(-6)
    .map((m) => `${m.role === 'user' ? 'Utilisateur' : 'Assistant'}: ${m.content}`)
    .join('\n');

  const prompt = `${historyText ? `Historique:\n${historyText}\n\n` : ''}Contexte candidatures M-ECAL: ${JSON.stringify(stats)}

Question: ${question}

Réponds de façon concise, actionnable, avec des chiffres tirés du contexte quand c'est pertinent.`;

  return callAIText(prompt, MARKETING_SYSTEM, 1200);
}

export async function generateMarketingContent({ prompt, templateKey, stats = {} }) {
  const label = TEMPLATE_LABELS[templateKey] || templateKey || 'Contenu marketing';
  const userPrompt =
    prompt ||
    `Génère un email marketing complet « ${label} » pour M-ECAL (services logistiques RDC).
Contexte candidatures: ${JSON.stringify(stats)}
Inclus: objet, corps structuré, signature M-ECAL. Ton professionnel B2B.`;

  const text = await callAIText(userPrompt, MARKETING_SYSTEM, 1800);
  return { title: label, content: text };
}

export async function loadApplicationsForMarketing() {
  return Application.find().populate('opportunity').sort({ updatedAt: -1 }).lean();
}
