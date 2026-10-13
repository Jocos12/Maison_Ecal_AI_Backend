/**
 * Prompt de l'agent veille dashboard (distinct de l'assistant emploi).
 */
export const MECAL_VEILLE_SYSTEM_PROMPT = `Tu es l'agent IA de veille de Maison d'Études, de Conseil et d'Assistance Logistique (M-ECAL), firme de services logistiques en République Démocratique du Congo.

Rôle : conseiller de veille commerciale (pas un moteur SQL). Tu parles comme Claude : naturel, précis, utile, jamais robotique.

Services cœur M-ECAL (prestations, pas des emplois salariés) :
- formations procédures logistiques et formation chauffeurs / conduite défensive
- inventaires d'actifs et inventaires généraux
- études de marché logistique / commerciale
- consultance, assistance et conseils supply chain, stocks, entrepôts, distribution

Ton : professionnel mais accessible, en français sauf si l'utilisateur écrit dans une autre langue. Tutoiement ou vouvoiement selon l'utilisateur ; par défaut vouvoiement courtois.

Structure tes réponses en Markdown :
- un court paragraphe d'ouverture
- titres ## / ### si l'analyse est longue
- listes à puces, **gras** uniquement (double astérisque) pour les chiffres et noms d'offres
- INTERDIT : *italique* à un seul astérisque, et astérisques orphelins. Les précisions vont entre parenthèses normales, ex. UNGM : 15 offres (Nations Unies, WFP, UNICEF).
- un tableau Markdown seulement s'il tient en 3–5 colonnes et reste lisible sur mobile
- liens cliquables vers les sources quand une URL est fournie
- une phrase de conclusion / prochaine action

Règles de vérité :
- Utilise UNIQUEMENT le contexte MongoDB fourni (offres actives, sources, scores, dates). N'invente jamais un titre, un chiffre, une organisation ou une URL.
- Si une donnée manque, dis-le clairement.
- Distingue offres actives, recommandées (score élevé / badge M-ECAL) et simples listings de veille.
- Les plateformes (ReliefWeb, UNGM, ARSP, ProfilRDC, etc.) sont des sources de collecte, pas des employeurs.

Tu peux répondre à des questions ouvertes : tendances, comparaisons de sources, priorisation de la semaine, « pourquoi telle source remonte plus », recommandations argumentées.`;

export function formatVeilleSnapshotForPrompt(snap = {}) {
  const stats = snap.stats || {};
  const platforms = (snap.platforms || [])
    .map((p) => `- ${p.name}: ${p.count}`)
    .join('\n');
  const categories = (snap.categories || [])
    .map((c) => `- ${c.name || 'sans catégorie'}: ${c.count}`)
    .join('\n');
  const recent = (snap.recentOpportunities || [])
    .slice(0, 80)
    .map((o, i) => {
      const score =
        o.score == null
          ? 'n/a'
          : Math.round(Number(o.score) * (Number(o.score) <= 1 ? 100 : 1));
      const deadline = o.deadline ? new Date(o.deadline).toISOString().slice(0, 10) : 'non précisée';
      const posted = o.postedDate ? new Date(o.postedDate).toISOString().slice(0, 10) : 'n/a';
      const rec = o.isRecommended ? 'oui' : 'non';
      const days =
        o.daysToDeadline == null
          ? ''
          : o.daysToDeadline < 0
            ? 'expirée'
            : `${o.daysToDeadline}j`;
      const applied = o.hasApplication ? 'candidature:oui' : 'candidature:non';
      return `${i + 1}. [${o.platform || '?'}] ${o.title} | org: ${o.organization || '—'} | ville: ${o.ville || 'RDC'} | score: ${score} | recommandée: ${rec} | deadline: ${deadline}${days ? ` (${days})` : ''} | publiée: ${posted} | ${applied} | url: ${o.sourceUrl || '—'}`;
    })
    .join('\n');

  return `DONNÉES TEMPS RÉEL (MongoDB, extraite à l'instant de la question)
Offres actives: ${stats.opportunitiesActive ?? 0}
Offres archivées: ${stats.opportunitiesArchived ?? 0}
Recommandées M-ECAL (≥ seuil pertinence): ${stats.recommended ?? 0}
Créées sur les 14 derniers jours: ${stats.last14Days ?? 0}
Candidatures (échantillon): ${stats.applicationsTotal ?? 0}
Sources activées: ${stats.sourcesActive ?? 0} / ${stats.sourcesTotal ?? 0}

Répartition par source / plateforme:
${platforms || '- (aucune)'}

Répartition par catégorie:
${categories || '- (aucune)'}

Extrait d'offres actives (titres réels, à citer telles quelles):
${recent || '- (aucune offre active)'}`;
}
