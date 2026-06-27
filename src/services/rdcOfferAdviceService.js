import Opportunity from '../models/Opportunity.js';
import { callAIForJSON, callAIText } from './aiService.js';
import { searchJobsWithAI } from './jobSearchService.js';
import { detectMessageLanguage } from '../utils/detectMessageLanguage.js';
import { getLanguageInstruction } from '../prompts/jobAssistantPrompt.js';

const MECAL_CONTEXT = `M-ECAL (Maison d'Études, Conseil & Assistance Logistique) opère en RDC.
Services cœur : formation logistique, consultance, inventaire (actifs/général), études de marché, assistance logistique.
Villes clés : Kinshasa, Lubumbashi, Goma, Bukavu, Kalemie.`;

function isJobOffer(offer) {
  return (
    offer?.aiAnalysis?.type === 'offre_emploi' ||
    offer?.aiAnalysis?.est_emploi === true ||
    /recrut|emploi|consultant|poste|vacance/i.test(offer?.title || '')
  );
}

function isVerifiedRdc(offer) {
  return (
    offer?.locationStatus === 'rdc_confirme' || offer?.aiAnalysis?.pays_confirme_rdc === 'true'
  );
}

function formatOfferBlock(offer, index) {
  if (!offer) return '';
  return `${index}. ID: ${offer._id || offer.id || index}
   Titre: ${offer.title || 'N/A'}
   Organisation: ${offer.organization || 'N/A'}
   Plateforme: ${offer.platform || 'N/A'}
   Ville: ${offer.ville || offer.city || 'N/A'}
   Catégorie: ${offer.category || 'N/A'}
   Type: ${offer.aiAnalysis?.type || 'N/A'}
   Score IA: ${offer.aiAnalysis?.score ?? offer.aiRelevanceScore ?? 'N/A'}
   URL: ${offer.sourceUrl || 'N/A'}
   Description: ${(offer.description || '').slice(0, 400)}`;
}

function formatOffersList(offers = []) {
  return offers.map((o, i) => formatOfferBlock(o, i + 1)).join('\n\n');
}

function wantsJobSearch(message = '') {
  const m = message.toLowerCase();
  return (
    /\b(trouv|recherch|cherche)\b/.test(m) ||
    /\boffres?\s+(d'|de\s+)?emploi\b/.test(m) ||
    /\bvacance/.test(m) ||
    /\blinkedin\b/.test(m) && /\b(trouv|recherch|cherche|similaire)/.test(m) ||
    /\brecrutement\b/.test(m)
  );
}

function wantsCountOrList(message = '') {
  const m = message.toLowerCase();
  if (
    (/combien|nombre|total/.test(m) &&
      /email|mail|gmail|message|messagerie|non lu/.test(m)) ||
    (/candidature|postulation/.test(m) && /combien|nombre|total/.test(m))
  ) {
    return false;
  }
  return (
    /\b(combien|nombre|total|how many|nombres?\s+exact)\b/.test(m) ||
    /\b(liste|affiche|montre|quelles?)\b.*\boffre/.test(m) ||
    /\boffres?\b.*\b(combien|nombre|linkedin|rdc)\b/.test(m) ||
    (/page.*opportunit|opportunit.*page|dans la page/.test(m) &&
      /\b(combien|nombre|total|exact|offres?\s+(qui|il y a|se trouv))\b/.test(m))
  );
}

async function getDbStats() {
  try {
    const [totalActive, verifiedRdc, employment] = await Promise.all([
      Opportunity.countDocuments({ isArchived: false }),
      Opportunity.countDocuments({ isArchived: false, locationStatus: 'rdc_confirme' }),
      Opportunity.countDocuments({
        isArchived: false,
        $or: [
          { 'aiAnalysis.est_emploi': true },
          { 'aiAnalysis.type': 'offre_emploi' }
        ]
      })
    ]);
    return { totalActive, verifiedRdc, employment };
  } catch {
    return null;
  }
}

export function rankOffersLocally(offers = []) {
  if (!offers.length) {
    return {
      summary: 'Aucune offre vérifiée à analyser pour le moment.',
      picks: [],
      provider: 'local'
    };
  }

  const picks = [...offers]
    .sort(
      (a, b) =>
        (b.aiAnalysis?.score ?? b.aiRelevanceScore ?? 0) -
        (a.aiAnalysis?.score ?? a.aiRelevanceScore ?? 0)
    )
    .slice(0, 3)
    .map((o) => ({
      id: o._id,
      score: Math.round(
        (o.aiAnalysis?.score ?? o.aiRelevanceScore ?? 50) *
          ((o.aiAnalysis?.score ?? 0) > 1 ? 1 : 100)
      ),
      reason: isJobOffer(o)
        ? 'Offre emploi/recrutement — priorité haute pour M-ECAL'
        : 'Mission logistique vérifiée RDC — bon potentiel commercial',
      action: isJobOffer(o) ? 'postuler' : 'surveiller',
      offer: o
    }));

  const jobs = offers.filter(isJobOffer).length;
  return {
    summary: `${offers.length} offre(s) vérifiée(s) RDC dans ce panneau (${jobs} emploi/recrutement). Classement basé sur le score de veille M-ECAL — sans appel IA cloud.`,
    picks,
    provider: 'local'
  };
}

async function answerFromLocalData(message, { offers = [], offer = null, dbStats = null }) {
  if (!wantsCountOrList(message)) return null;

  const m = message.toLowerCase();
  const panelJobs = offers.filter(isJobOffer);
  const panelVerified = offers.filter(isVerifiedRdc);
  const stats = dbStats || (await getDbStats());

  if (/combien|nombre|total/.test(m)) {
    const lines = ['📊 **Comptage des offres M-ECAL**', ''];

    if (/linkedin/.test(m)) {
      lines.push(
        'LinkedIn ne permet pas d\'être interrogé directement par M-ECAL (pas d\'API publique gratuite).',
        'Les chiffres ci-dessous proviennent de **notre veille multi-sources** (ProfilRDC, ReliefWeb, UNjobs, etc.).',
        ''
      );
    }

    lines.push(
      `• **${offers.length}** offre(s) chargée(s) sur la page Opportunités (agent / panneau actuel)`,
      `• **${panelVerified.length}** offre(s) vérifiée(s) RDC sur cette page`,
      `• **${panelJobs.length}** liée(s) à l'emploi / recrutement (panneau actuel)`
    );

    if (stats) {
      lines.push(
        `• **${stats.totalActive}** opportunité(s) actives en base M-ECAL`,
        `• **${stats.verifiedRdc}** confirmée(s) en RDC (toute la base)`,
        `• **${stats.employment}** emploi/recrutement (toute la base)`
      );
    }

    lines.push(
      '',
      '**Pour LinkedIn** : cliquez « Voir sur LinkedIn » sur une carte métier (période 7 jours recommandée).',
      'Les résultats LinkedIn varient selon votre compte et ne sont pas comptabilisés ici.'
    );

    return lines.join('\n');
  }

  if (/liste|affiche|montre|quelles/.test(m)) {
    const top = offers.slice(0, 6);
    if (!top.length) return 'Aucune offre vérifiée à lister pour le moment.';

    const list = top
      .map((o, i) => `${i + 1}. **${o.title}** — ${o.organization || o.platform} (${o.ville || 'RDC'})`)
      .join('\n');

    return `**Offres vérifiées récentes :**\n\n${list}\n\nCliquez « Discuter avec l'IA » sur une carte pour l'analyser.`;
  }

  if (offer && /cette offre|celle-ci|convient|postuler/.test(m)) {
    return null;
  }

  return null;
}

async function safeCallAIText(prompt, systemPrompt, maxTokens = 1200) {
  try {
    const text = await callAIText(prompt, systemPrompt, maxTokens);
    return text?.trim() || null;
  } catch {
    return null;
  }
}

const QUOTA_NOTE =
  '\n\n_IA cloud temporairement indisponible (quota Groq/Claude/Gemini épuisé). Réponse générée localement depuis la veille M-ECAL._';

function offlineOfferAdvice(offer, message) {
  if (!offer) {
    return `Les quotas IA cloud sont épuisés pour aujourd'hui. Utilisez les données ci-dessous ou les recherches LinkedIn par métier.${QUOTA_NOTE}`;
  }

  const score = offer.aiAnalysis?.score ?? offer.aiRelevanceScore;
  const isJob = isJobOffer(offer);
  const verified = isVerifiedRdc(offer);

  const lines = [
    '**Analyse locale (sans IA cloud)**',
    '',
    `• **Offre :** ${offer.title}`,
    `• **Organisation :** ${offer.organization || 'Non précisé'}`,
    `• **Ville :** ${offer.ville || 'Non précisé'}`,
    `• **Type :** ${isJob ? 'emploi / recrutement' : 'mission / service logistique'}`,
    `• **RDC :** ${verified ? '✅ confirmée par la veille' : '⚠️ à vérifier'}`
  ];

  if (score != null) lines.push(`• **Score veille :** ${score}`);

  lines.push(
    '',
    verified
      ? '**Recommandation M-ECAL :** offre fiable côté localisation — étudiez une réponse commerciale ou une candidature selon le type.'
      : '**Recommandation :** vérifier la localisation avant engagement.',
    '',
    '**Prochaines étapes :** 1) Ouvrir la source officielle 2) Préparer CV/lettre (Assistant Emploi) 3) Respecter l\'échéance.'
  );

  if (/postul|convient|candidat/i.test(message)) {
    lines.push('', isJob ? '→ Priorité **postuler** si le profil correspond.' : '→ Priorité **réponse commerciale** (consultance/mission).');
  }

  return lines.join('\n') + QUOTA_NOTE;
}

function offlineSearchAdvice(searchResult, offer) {
  const jobs = searchResult?.jobs || [];
  if (!jobs.length) {
    return (
      (searchResult?.message ||
        'Aucune offre trouvée sur les sources M-ECAL. Élargissez la zone (7–30 jours) sur LinkedIn ou réessayez plus tard.') +
      QUOTA_NOTE
    );
  }

  const list = jobs
    .slice(0, 5)
    .map((j, i) => `${i + 1}. ${j.title} — ${j.organization} (${j.city})`)
    .join('\n');

  return `**Offres vérifiées trouvées (${jobs.length}) :**\n\n${list}\n\n${
    offer ? `Contexte : ${offer.title}\n\n` : ''
  }Sélectionnez une offre pour approfondir via l'Assistant Emploi.${QUOTA_NOTE}`;
}

export async function rankOffersForMecal(offers = [], { forceAi = false } = {}) {
  if (!offers.length) return rankOffersLocally([]);

  if (!forceAi) {
    return rankOffersLocally(offers);
  }

  const prompt = `Analyse ces opportunités logistique RDC pour M-ECAL. Classe les 3 meilleures.
Offres:
${formatOffersList(offers.slice(0, 10))}

JSON: {"summary":"...","picks":[{"id":"...","score":85,"reason":"...","action":"postuler|surveiller|décliner"}]}`;

  try {
    const { data, provider } = await callAIForJSON(
      prompt,
      `${MECAL_CONTEXT}\nConseiller M-ECAL. JSON uniquement. Français.`
    );
    const picks = (data?.picks || []).map((p) => {
      const matched = offers.find((o) => String(o._id) === String(p.id));
      return { ...p, offer: matched };
    });
    return {
      summary: data?.summary || rankOffersLocally(offers).summary,
      picks: picks.length ? picks : rankOffersLocally(offers).picks,
      provider
    };
  } catch {
    return rankOffersLocally(offers);
  }
}

export async function chatAboutRdcOffer({
  offer,
  offers = [],
  messages = [],
  message,
  systemContext = null
}) {
  const dbStats = await getDbStats();

  const localAnswer = await answerFromLocalData(message, { offers, offer, dbStats });
  if (localAnswer) {
    return { reply: localAnswer, jobs: [], isSearch: false, provider: 'local' };
  }

  const history = messages
    .slice(-14)
    .map((m) => `${m.role === 'user' ? 'Utilisateur' : 'Assistant'}: ${m.content}`)
    .join('\n');

  if (wantsJobSearch(message)) {
    let searchResult = { jobs: [], message: '' };
    try {
      searchResult = await searchJobsWithAI({
        query: message,
        allRdc: true,
        userNeed: message
      });
    } catch {
      searchResult = {
        jobs: [],
        message: 'Recherche multi-sources indisponible. Utilisez les liens LinkedIn par métier ci-dessous.'
      };
    }

    if (!searchResult.jobs?.length) {
      const localJobs = offers.filter(isJobOffer).slice(0, 5);
      if (localJobs.length) {
        searchResult.jobs = localJobs.map((o) => ({
          title: o.title,
          organization: o.organization || o.platform,
          city: o.ville || 'RDC',
          sourceUrl: o.sourceUrl || ''
        }));
      }
    }

    const jobsBlock = (searchResult.jobs || [])
      .slice(0, 8)
      .map((j, i) => `${i + 1}. ${j.title} — ${j.organization} (${j.city})`)
      .join('\n');

    const advicePrompt = `${history ? `Historique:\n${history}\n\n` : ''}Demande: ${message}\nOffres:\n${jobsBlock}\n${
      offer ? formatOfferBlock(offer, 1) : ''
    }`;

    const reply = await safeCallAIText(
      advicePrompt,
      `${MECAL_CONTEXT}\nAssistant M-ECAL. Français.`
    );

    return {
      reply: reply || offlineSearchAdvice(searchResult, offer),
      jobs: searchResult.jobs || [],
      suggestions: searchResult.suggestions || [],
      manualLinks: searchResult.manualLinks || [],
      isSearch: true,
      provider: reply ? 'ai' : 'local'
    };
  }

  const offerBlock = offer ? formatOfferBlock(offer, 1) : formatOffersList(offers.slice(0, 6));

  const systemBlock = systemContext?.aiContextBlock
    ? `\n\nCONTEXTE SYSTÈME M-ECAL (données temps réel — utilise pour toute question sur offres, emails, candidatures, plateformes):\n${systemContext.aiContextBlock}\n`
    : systemContext
      ? `\n\nCONTEXTE PLATEFORME M-ECAL:\nPage: ${systemContext.currentPage || '/'}\nOffres: ${systemContext.opportunityCount}\nCandidatures: ${systemContext.applicationCount}\nGmail non lus: ${systemContext.gmailUnread ?? '?'}\n${systemContext.navList || ''}\n`
      : '';

  const prompt = `${history ? `Historique:\n${history}\n\n` : ''}${systemBlock}Contexte offres:\n${offerBlock}\n\nQuestion: ${message}`;

  const locale = detectMessageLanguage(message, messages);
  const langRule = getLanguageInstruction(locale);

  const reply = await safeCallAIText(
    prompt,
    `${MECAL_CONTEXT}\nTu es l'agent IA M-ECAL. Tu connais toute la plateforme (sidebar, pages, fonctionnalités, sources emploi : ReliefWeb, MediaCongo, UNjobnet, Coordination Sud, Impact Pool). ${langRule} Ne invente pas de liens. Si la question concerne le menu ou une page, guide l'utilisateur vers le bon chemin.`
  );

  return {
    reply: reply || offlineOfferAdvice(offer, message),
    jobs: [],
    isSearch: false,
    provider: reply ? 'ai' : 'local'
  };
}
