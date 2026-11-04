import { callAIForJSON } from './aiService.js';
import { detectMessageLanguage, languageLabel } from '../utils/detectMessageLanguage.js';
import logger from '../utils/logger.js';
import {
  countOpportunities,
  detectCity,
  findOpportunityByHint,
  listApplications,
  listMatchingOpportunities
} from './voiceToolRuntime.js';
import { answerFromContracts, listContracts } from './contractService.js';

/** READ-ONLY tools — execute immediately, no confirmation */
export const VOICE_TOOLS_READ = Object.freeze([
  'naviguerVers',
  'afficherOffres',
  'filtrerOffres',
  'afficherCandidatures',
  'compterOffres',
  'lireCandidatures',
  'obtenirStatsContrats',
  'listerContrats'
]);

/** WRITE tools — draft creation is allowed; email send is never done here */
export const VOICE_TOOLS_WRITE = Object.freeze(['preparerCandidature']);

const TOOL_NAMES = [...VOICE_TOOLS_READ, ...VOICE_TOOLS_WRITE];

export const VOICE_AGENT_SYSTEM_PROMPT = `Tu es l'assistant emploi de M-ECAL (Maison d'Études, Conseil & Assistance Logistique, RDC).

COMPORTEMENT — priorité absolue
Quand on te pose une question, ta priorité absolue est d'y répondre réellement — jamais de répondre par une liste de ce que tu sais faire en général. Si la réponse nécessite une donnée du système (offres, candidatures, statuts), appelle d'abord la fonction appropriée pour récupérer cette donnée réelle, puis réponds avec elle, de façon directe et concrète.

Si tu ne peux traiter qu'une partie de la demande, dis ce que tu as fait, puis dis en une phrase simple ce que tu ne peux pas faire — sans t'excuser de façon excessive et sans lister tes fonctions disponibles comme un menu.

Si tu ne peux vraiment rien faire sur cette demande, dis-le en une phrase claire, et si une alternative utile existe, propose-la. Exemple : si on te demande une action que tu ne sais pas faire, ne réponds pas « je peux afficher les offres, les candidatures… » — réponds plutôt « je ne peux pas faire X pour le moment, mais je peux Y si ça t'aide ».

Ne reformule jamais une question précise de l'utilisateur en question ouverte. Si on te demande « quelles offres correspondent à M-ECAL », ne réponds pas par « que puis-je faire pour vous ? » — va chercher la réponse et donne-la.

Sois concis, direct, et évite les formules vagues ou les réponses qui ne font que décrire tes capacités sans agir dessus.

Deux registres :

1) CONVERSATION GÉNÉRALE (small talk, « comment tu vas ? », questions sur toi, remerciements, blagues légères)
→ Réponds naturellement, comme un collègue : chaleureux, court, direct.
→ Exemple : « Comment tu vas ? » → « Ça va bien, merci. Et toi ? »
→ Pas de liste de fonctions, pas de « que puis-je faire pour vous ? ».
→ actions = [] (aucune navigation).

2) QUESTIONS FACTUELLES / COMMANDES sur le système (offres, candidatures, stats, navigation, postuler)
→ Base-toi uniquement sur les données réelles renvoyées par les outils. N'invente jamais un nombre, un statut, une offre, un ID ou une organisation.
→ Si l'outil ne renvoie rien, dis-le en une phrase. Ne compense pas par un menu.

Tu analyses la commande et renvoies UNIQUEMENT un JSON valide :
{
  "reply": "réponse directe, même langue que l'utilisateur",
  "actions": [ { "tool": "<nom>", "args": { } } ],
  "awaitConfirmation": false
}

Outils LECTURE (exécution directe, awaitConfirmation=false) :
- naviguerVers: args { "page": "opportunities|applications|dashboard|sources|settings|agent|messaging|analytics|alerts|archive|marketing|assistant-emploi|contrats|cycle" }
- afficherOffres / filtrerOffres: args { "search"?: string, "category"?: string, "ville"?: string, "mecalFit"?: boolean, "offreId"?: string }
  → mecalFit=true quand on demande quelles offres cadrent / correspondent à M-ECAL.
- compterOffres: args { "ville"?: string, "today"?: boolean, "search"?: string }
- afficherCandidatures: args { "statut"?: "draft|submitted|pending|won|rejected" }
- lireCandidatures: args { "statut"?: string }
  → statut "pending" pour « en attente ».
- obtenirStatsContrats / listerContrats: args { "owner"?: "me"|"all" }
  → chiffres et liste réels des contrats. Jamais de montant inventé.
- Pour supprimer ou modifier un contrat : ne appelle aucun outil d'écriture. Dis que la confirmation se fait sur la page Contrats. actions = [{ "tool": "naviguerVers", "args": { "page": "contrats" } }].

Outils ÉCRITURE :
- preparerCandidature: args { "offreId"?: string, "title"?: string, "search"?: string, "offerIndex"?: number }
  → prépare seulement. Ne crée rien et n'envoie rien tant que l'utilisateur n'a pas confirmé explicitement.
  → reply nomme l'offre et demande cette confirmation. awaitConfirmation=true.

SÉCURITÉ (inchangée) :
- N'envoie JAMAIS d'e-mail et n'archive JAMAIS via ces outils.
- Aucune candidature n'est enregistrée sans confirmation explicite de l'utilisateur.
- Pour un envoi réel : l'utilisateur doit confirmer, puis « Confirmer et envoyer ».

Langue de reply : {{LANG}}.`;

function heuristicParse(text = '', locale = 'fr') {
  const m = String(text).toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
  const isEn = locale === 'en';

  // Small talk / conversation générale — no tools
  if (
    !/\b(offre|offres|candidature|postul|opportunit|job|apply|navigue|montre|affiche|filtre)\b/.test(m) &&
    /\b(comment (tu|ca|ça) vas?\b|ca va\b|ça va\b|how are you|how're you|qui es[- ]tu|who are you|bonjour|salut|hello|hi\b|hey\b|merci|thanks|thank you|bonne (journee|soirée)|au revoir|bye)\b/.test(
      m
    )
  ) {
    if (/comment (tu|ca|ça) va|ca va\b|ça va\b|how are you/.test(m)) {
      return {
        reply: isEn
          ? "I'm doing well, thanks. And you?"
          : 'Ça va bien, merci. Et toi ?',
        actions: [],
        awaitConfirmation: false,
        decisive: true
      };
    }
    if (/qui es[- ]tu|who are you/.test(m)) {
      return {
        reply: isEn
          ? "I'm the M-ECAL job assistant for logistics opportunities in the DRC."
          : 'Je suis l’assistant emploi M-ECAL, pour la logistique en RDC.',
        actions: [],
        awaitConfirmation: false,
        decisive: true
      };
    }
    if (/merci|thanks|thank you/.test(m)) {
      return {
        reply: isEn ? "You're welcome!" : 'Avec plaisir !',
        actions: [],
        awaitConfirmation: false,
        decisive: true
      };
    }
    if (/bonjour|salut|hello|hi|hey/.test(m)) {
      return {
        reply: isEn ? 'Hi.' : 'Bonjour.',
        actions: [],
        awaitConfirmation: false,
        decisive: true
      };
    }
  }

  if (
    /\b(telephone|phone|call me|m'appeler|m appeler)\b/.test(m) &&
    !/\b(offre|candidature|postul)\b/.test(m)
  ) {
    return {
      reply: isEn ? "I can't call you on the phone." : 'Je ne peux pas vous appeler au téléphone.',
      actions: [],
      awaitConfirmation: false,
      decisive: true
    };
  }

  if (/\b(combien|how many|nombre)\b/.test(m) && /\b(offre|offres|opportunit|jobs?)\b/.test(m)) {
    const ville = detectCity(m);
    const today = /aujourd.?hui|today|ce jour/.test(m);
    return {
      reply: isEn ? 'I am counting the offers now.' : 'Je compte les offres.',
      actions: [{ tool: 'compterOffres', args: { ...(ville ? { ville } : {}), ...(today ? { today: true } : {}) } }],
      awaitConfirmation: false
    };
  }

  if (
    /\b(filtre|filtrer|filter|affiche|montre|voir)\b/.test(m) &&
    /\b(offre|offres|opportunit)\b/.test(m)
  ) {
    const ville = detectCity(m);
    const pendingApps = /candidature/.test(m);
    if (!pendingApps) {
      return {
        reply: isEn
          ? `Alright, filtering offers${ville ? ` in ${ville}` : ''}.`
          : `D'accord, je filtre les offres${ville ? ` de ${ville}` : ''}.`,
        actions: [
          {
            tool: 'filtrerOffres',
            args: { ...(ville ? { ville } : {}) }
          }
        ],
        awaitConfirmation: false
      };
    }
  }

  if (/\b(candidature|candidatures|applications?)\b/.test(m) && /\b(montre|affiche|voir|show|list|open|attente)\b/.test(m)) {
    const statut = /attente|pending/.test(m)
      ? 'pending'
      : /brouillon|draft/.test(m)
        ? 'draft'
        : /soumis|submitted/.test(m)
          ? 'submitted'
          : undefined;
    return {
      reply: isEn ? 'Opening your applications.' : 'D’accord, j’affiche vos candidatures.',
      actions: [
        { tool: 'lireCandidatures', args: statut ? { statut } : {} },
        { tool: 'afficherCandidatures', args: statut ? { statut } : {} }
      ],
      awaitConfirmation: false
    };
  }

  if (/\bcontrats?\b/.test(m) && /\b(supprim|effac|modifi)/.test(m)) {
    return {
      reply: isEn
        ? 'I will not change a contract without your confirmation on the Contracts page.'
        : 'Je ne modifie ni ne supprime un contrat sans votre confirmation sur la page Contrats et travaux.',
      actions: [{ tool: 'naviguerVers', args: { page: 'contrats' } }],
      awaitConfirmation: false
    };
  }

  if (/\bcontrats?\b/.test(m) && /\b(combien|taux|gagn|liste|montre|affiche)\b/.test(m)) {
    const listing = /\b(liste|montre|affiche)\b/.test(m);
    return {
      reply: listing
        ? isEn
          ? 'Here are the stored contracts.'
          : 'Voici les contrats enregistrés.'
        : isEn
          ? 'Here are the contract figures.'
          : 'Voici les chiffres des contrats.',
      actions: [
        {
          tool: listing ? 'listerContrats' : 'obtenirStatsContrats',
          args: { owner: /\b(mes|mon|my)\b/.test(m) ? 'me' : 'all' }
        }
      ],
      awaitConfirmation: false
    };
  }

  if (/\b(postule|postuler|apply|candidater|prepare|prépare|preparer|préparer)\b/.test(m) && /\b(candidature|offre|post)\b/.test(m)) {
    const idx = m.match(/\b(?:offre|offer)\s*(?:n[°o.]?\s*)?(\d+)\b/);
    const offerIndex = idx ? Number(idx[1]) - 1 : null;
    const namedOffer = String(text).match(/\boffre\s+(?:de\s+|d['’]\s*)?([A-Za-zÀ-ÿ0-9][^?.!]{1,80})$/i);
    const titleMatch = namedOffer
      ? namedOffer
      : String(text).match(/(?:pour|offre)\s+(?:l['’]|la\s+|le\s+)?(.{2,80}?)(?:\s*$|\.|!|\?)/i);
    const title = titleMatch ? titleMatch[1].trim() : '';
    return {
      reply: isEn
        ? 'Alright, I am preparing a draft application.'
        : 'D’accord, je prépare une candidature en brouillon.',
      actions: [
        {
          tool: 'preparerCandidature',
          args: {
            ...(offerIndex != null && !Number.isNaN(offerIndex) ? { offerIndex } : {}),
            ...(title ? { title } : {})
          }
        }
      ],
      awaitConfirmation: false
    };
  }

  if (
    /\b(offre|offres|opportunit)\b/.test(m) &&
    /(cadr|correspond|m-?ecal|maison\s*ecal|convien)/.test(m) &&
    !/\b(postul|apply|candidater)\b/.test(m)
  ) {
    return {
      reply: isEn ? 'Here are the offers that fit M-ECAL.' : 'Voici les offres qui cadrent avec M-ECAL.',
      actions: [{ tool: 'afficherOffres', args: { mecalFit: true } }],
      awaitConfirmation: false
    };
  }

  if (/\b(offre|offres|opportunit|jobs?)\b/.test(m) && /\b(montre|affiche|voir|show|find|cherche|filtre)\b/.test(m)) {
    const mecalFit = /maison\s*ecal|mecal|correspond/.test(m);
    let search = '';
    const after = m.match(/(?:offres?|opportunit\w*|jobs?)\s+(?:de\s+|d'|pour\s+|about\s+|in\s+)?(.+)$/);
    if (after) {
      search = after[1]
        .replace(/\b(en rdc|rdc|qui correspondent?.*|please|s'il te plait|sil te plait)\b/g, '')
        .trim()
        .slice(0, 80);
    }
    if (mecalFit && !search) search = 'logistique';
    if (/logistique/.test(m)) search = search || 'logistique';
    return {
      reply: isEn
        ? `Showing opportunities${search ? ` for “${search}”` : ''}.`
        : `Voici les offres${search ? ` pour « ${search} »` : ''}.`,
      actions: [
        {
          tool: 'afficherOffres',
          args: {
            ...(search ? { search } : {}),
            ...(mecalFit ? { mecalFit: true } : {})
          }
        }
      ],
      awaitConfirmation: false
    };
  }

  // Navigation: "va / ouvre / montre / page …"
  if (
    /\b(va|ouvre|open|go|navigue|amener|montre|affiche|voir|page)\b/.test(m) ||
    /\b(source|sources|veille|eveil)\b/.test(m)
  ) {
    if (/\bcycle\b|parcours/.test(m)) {
      return {
        reply: isEn ? 'Opening the lifecycle page.' : 'Direction Cycle de vie.',
        actions: [{ tool: 'naviguerVers', args: { page: 'cycle' } }],
        awaitConfirmation: false
      };
    }
    if (/candidature|application/.test(m)) {
      return {
        reply: isEn ? 'Going to Applications.' : 'Direction Candidatures.',
        actions: [{ tool: 'naviguerVers', args: { page: 'applications' } }],
        awaitConfirmation: false
      };
    }
    if (/offre|opportunit|job/.test(m)) {
      return {
        reply: isEn ? 'Going to Opportunities.' : 'Direction Opportunités.',
        actions: [{ tool: 'naviguerVers', args: { page: 'opportunities' } }],
        awaitConfirmation: false
      };
    }
    // "sources", "veille", STT often hears "éveil" for "veille"
    if (/source|sources|veille|eveil/.test(m)) {
      return {
        reply: isEn ? 'Going to Sources / watch list.' : 'Direction Sources / veille.',
        actions: [{ tool: 'naviguerVers', args: { page: 'sources' } }],
        awaitConfirmation: false
      };
    }
    if (/parametre|setting/.test(m)) {
      return {
        reply: isEn ? 'Going to Settings.' : 'Direction Paramètres.',
        actions: [{ tool: 'naviguerVers', args: { page: 'settings' } }],
        awaitConfirmation: false
      };
    }
    if (/tableau|dashboard|accueil/.test(m)) {
      return {
        reply: isEn ? 'Going to the dashboard.' : 'Direction tableau de bord.',
        actions: [{ tool: 'naviguerVers', args: { page: 'dashboard' } }],
        awaitConfirmation: false
      };
    }
    if (/contrat/.test(m)) {
      return {
        reply: isEn ? 'Opening Contracts and work.' : 'Direction Contrats et travaux.',
        actions: [{ tool: 'naviguerVers', args: { page: 'contrats' } }],
        awaitConfirmation: false
      };
    }
    if (/assistant|emploi/.test(m)) {
      return {
        reply: isEn ? 'Opening the job assistant.' : 'J’ouvre l’Assistant Emploi.',
        actions: [{ tool: 'naviguerVers', args: { page: 'assistant-emploi' } }],
        awaitConfirmation: false
      };
    }
  }

  return {
    reply: isEn ? "I can't do that." : 'Je ne peux pas faire ça.',
    actions: [],
    awaitConfirmation: false
  };
}

function sanitizePayload(raw, locale) {
  const fallback = heuristicParse('', locale);
  if (!raw || typeof raw !== 'object') return fallback;

  const actions = Array.isArray(raw.actions)
    ? raw.actions
        .filter((a) => a && TOOL_NAMES.includes(String(a.tool || a.name)))
        .map((a) => ({
          tool: String(a.tool || a.name),
          args: a.args && typeof a.args === 'object' ? a.args : {}
        }))
        .slice(0, 3)
    : [];

  const hasPrepare = actions.some((a) => a.tool === 'preparerCandidature');
  // Strip any write tool that somehow isn't preparerCandidature (future-proof)
  const safeActions = actions.filter(
    (a) => VOICE_TOOLS_READ.includes(a.tool) || VOICE_TOOLS_WRITE.includes(a.tool)
  );

  return {
    reply: String(raw.reply || fallback.reply).slice(0, 600),
    actions: safeActions,
    awaitConfirmation: false
  };
}

async function executeActions(payload, locale, userId = null) {
  const isEn = locale === 'en';
  const extra = { toolResults: {}, createdApplication: null };
  const actions = payload.actions || [];
  const replies = [];

  for (const action of actions) {
    if (action.tool === 'compterOffres') {
      const result = await countOpportunities(action.args || {});
      extra.toolResults.compterOffres = result;
      const where = result.filter.ville
        ? isEn
          ? ` in ${result.filter.ville}`
          : ` à ${result.filter.ville}`
        : result.filter.today
          ? isEn
            ? ' today'
            : " aujourd'hui"
          : '';
      replies.push(
        isEn
          ? `There are ${result.count} active offers${where}.`
          : `Il y a ${result.count} offres actives${where}.`
      );
    }
    if (action.tool === 'lireCandidatures') {
      const result = await listApplications(action.args || {});
      extra.toolResults.lireCandidatures = result;
      const statusLabel =
        result.statut === 'pending' ? (isEn ? 'pending' : 'en attente') : result.statut;
      replies.push(
        isEn
          ? `You have ${result.total} application(s)${statusLabel ? ` ${statusLabel}` : ''}.`
          : `Vous avez ${result.total} candidature${result.total > 1 ? 's' : ''}${statusLabel ? ` ${statusLabel}` : ''}.`
      );
    }
    if (action.tool === 'preparerCandidature') {
      const opp = await findOpportunityByHint(action.args || {});
      if (!opp) {
        replies.push(
          isEn ? 'I could not find that offer.' : 'Je n’ai pas trouvé cette offre.'
        );
        continue;
      }
      // Stage only. ApplicationConfirmGate persists the draft after an explicit confirm.
      const prepared = {
        offreId: String(opp._id),
        title: opp.title,
        organization: opp.organization || opp.platform || '',
        ville: opp.ville || opp.location || 'RDC'
      };
      action.args = { ...action.args, offreId: prepared.offreId, title: prepared.title };
      extra.preparedApplication = prepared;
      extra.toolResults.preparerCandidature = prepared;
      payload.awaitConfirmation = true;
      replies.push(
        isEn
          ? `I can prepare a draft for “${opp.title}”. Nothing is saved until you confirm.`
          : `Je prépare un brouillon pour « ${opp.title} ». Rien n’est enregistré tant que vous n’avez pas confirmé.`
      );
    }
    if (action.tool === 'filtrerOffres' || action.tool === 'afficherOffres') {
      const listed = await listMatchingOpportunities(action.args || {});
      extra.toolResults.afficherOffres = listed;
      const ville = action.args?.ville;
      if (!listed.items.length) {
        const reviewNote =
          action.args?.mecalFit && listed.review
            ? isEn
              ? ` ${listed.review} still need a review.`
              : ` ${listed.review} sont encore à vérifier.`
            : '';
        replies.push(
          (action.args?.mecalFit
            ? isEn
              ? 'No active offer currently fits M-ECAL.'
              : 'Aucune offre active ne cadre avec M-ECAL pour le moment.'
            : isEn
              ? `No matching offers${ville ? ` in ${ville}` : ''}.`
              : `Aucune offre correspondante${ville ? ` à ${ville}` : ''}.`) + reviewNote
        );
      } else {
        const lines = listed.items
          .map((o, i) => `${i + 1}. ${o.title}${o.organization ? ` — ${o.organization}` : ''}`)
          .join(' ; ');
        const n = listed.total;
        const head = action.args?.mecalFit
          ? isEn
            ? `${n} offer${n > 1 ? 's' : ''} fit M-ECAL:`
            : `${n} offre${n > 1 ? 's' : ''} ${n > 1 ? 'cadrent' : 'cadre'} avec M-ECAL :`
          : isEn
            ? `${n} matching offer${n > 1 ? 's' : ''}${ville ? ` in ${ville}` : ''}:`
            : `${n} offre${n > 1 ? 's' : ''} correspondante${n > 1 ? 's' : ''}${ville ? ` à ${ville}` : ''} :`;
        replies.push(`${head} ${lines}`);
      }
    }
    if (action.tool === 'obtenirStatsContrats' || action.tool === 'listerContrats') {
      const owner = action.args?.owner === 'me' ? 'me' : 'all';
      const rows = await listContracts({ userId, owner });
      extra.toolResults[action.tool] = { total: rows.length };
      replies.push(
        action.tool === 'listerContrats'
          ? rows.length
            ? rows
                .slice(0, 6)
                .map((row, i) => `${i + 1}. ${row.title} — ${row.client} (${row.status})`)
                .join(' ; ')
            : isEn
              ? 'No contracts stored.'
              : 'Aucun contrat enregistré.'
          : answerFromContracts(isEn ? 'summary' : 'résumé', rows, userId)
      );
    }
    if (action.tool === 'afficherCandidatures') {
      replies.push(
        isEn ? 'I am opening your applications.' : 'J’affiche vos candidatures.'
      );
    }
  }

  if (replies.length) {
    payload.reply = replies[0];
  }
  return { ...payload, ...extra };
}

/**
 * Parse a voice/text command into a spoken reply + closed tool calls.
 * Never submits applications server-side.
 */
export async function processVoiceCommand({ text, locale: localeHint, userId = null } = {}) {
  const message = String(text || '').trim();
  if (!message) {
    return {
      reply: 'Je n’ai rien entendu. Réessayez.',
      actions: [],
      awaitConfirmation: false
    };
  }

  const locale = localeHint || detectMessageLanguage(message);
  const heuristic = heuristicParse(message, locale);

  // Clear small talk and out-of-scope replies stay as written. Don't let a model replace them with a menu.
  if (heuristic.decisive && !heuristic.actions.length) {
    return { ...heuristic, provider: 'heuristic' };
  }

  if (heuristic.actions.length) {
    return executeActions({ ...heuristic, provider: 'heuristic' }, locale, userId);
  }

  try {
    const system = VOICE_AGENT_SYSTEM_PROMPT.replace('{{LANG}}', languageLabel(locale));
    const raw = await callAIForJSON(
      `Commande utilisateur:\n"""${message}"""\n\nRéponds en JSON uniquement.`,
      system
    );
    const payload = sanitizePayload(raw, locale);
    if (
      !payload.actions.length &&
      /je peux discuter|i can chat, show applications|que puis-je faire/i.test(payload.reply || '')
    ) {
      payload.reply = heuristic.reply;
    }
    if (!payload.actions.length && heuristic.actions.length) {
      return executeActions({ ...heuristic, reply: payload.reply || heuristic.reply, provider: 'hybrid' }, locale, userId);
    }
    // If AI returned empty for small talk with weak reply, prefer heuristic small-talk
    if (
      !payload.actions.length &&
      heuristic.actions.length === 0 &&
      heuristic.reply &&
      payload.reply &&
      payload.reply.length < 20
    ) {
      return { ...heuristic, provider: 'heuristic' };
    }
    return executeActions({ ...payload, provider: 'ai' }, locale, userId);
  } catch (e) {
    logger.warn(`voiceCommand AI fallback: ${e.message}`);
    return executeActions({ ...heuristic, provider: 'heuristic' }, locale, userId);
  }
}
