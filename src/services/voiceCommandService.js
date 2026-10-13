import { callAIForJSON } from './aiService.js';
import { detectMessageLanguage, languageLabel } from '../utils/detectMessageLanguage.js';
import logger from '../utils/logger.js';
import {
  countOpportunities,
  createDraftApplication,
  detectCity,
  findOpportunityByHint,
  listApplications
} from './voiceToolRuntime.js';

/** READ-ONLY tools — execute immediately, no confirmation */
export const VOICE_TOOLS_READ = Object.freeze([
  'naviguerVers',
  'afficherOffres',
  'filtrerOffres',
  'afficherCandidatures',
  'compterOffres',
  'lireCandidatures'
]);

/** WRITE tools — draft creation is allowed; email send is never done here */
export const VOICE_TOOLS_WRITE = Object.freeze(['preparerCandidature']);

const TOOL_NAMES = [...VOICE_TOOLS_READ, ...VOICE_TOOLS_WRITE];

export const VOICE_AGENT_SYSTEM_PROMPT = `Tu es l'assistant emploi de M-ECAL (Maison d'Études, Conseil & Assistance Logistique, RDC).

Tu gères DEUX registres clairement séparés :

1) CONVERSATION GÉNÉRALE (small talk, « comment tu vas ? », questions sur toi, remerciements, blagues légères)
→ Réponds normalement et naturellement, comme un collègue serviable : chaleureux, court, direct.
→ Exemple : « Comment tu vas ? » → « Ça va bien, merci ! Je suis prêt à t'aider sur les offres ou candidatures. Et toi ? »
→ Pas de réponse vague, robotique, ni de digression sur les offres si ce n'est pas demandé.
→ actions = [] (aucune navigation).

2) QUESTIONS FACTUELLES / COMMANDES sur le système (offres, candidatures, stats, navigation, postuler)
→ Base-toi uniquement sur les données réelles de l'app quand elles sont fournies. Ne jamais inventer un nombre, un statut, une offre, un ID ou une organisation.
→ Si tu n'as pas la donnée : dis-le clairement.
→ Sois concis, clair, droit au but, sans formules creuses.

Tu analyses la commande et renvoies UNIQUEMENT un JSON valide :
{
  "reply": "phrase courte à lire à voix haute (même langue que l'utilisateur)",
  "actions": [ { "tool": "<nom>", "args": { } } ],
  "awaitConfirmation": false
}

Outils LECTURE (exécution directe, awaitConfirmation=false) :
- naviguerVers: args { "page": "opportunities|applications|dashboard|sources|settings|agent|messaging|analytics|alerts|archive|marketing|assistant-emploi" }
- afficherOffres / filtrerOffres: args { "search"?: string, "category"?: string, "ville"?: string, "mecalFit"?: boolean, "offreId"?: string }
- compterOffres: args { "ville"?: string, "today"?: boolean, "search"?: string }
- afficherCandidatures: args { "statut"?: "draft|submitted|pending|won|rejected" }
- lireCandidatures: args { "statut"?: string }

Outils ÉCRITURE :
- preparerCandidature: args { "offreId"?: string, "title"?: string, "search"?: string, "offerIndex"?: number }
  → crée un BROUILLON (réversible). JAMAIS d'envoi d'e-mail.
  → reply confirme verbalement l'action.

SÉCURITÉ :
- N'envoie JAMAIS d'e-mail et n'archive JAMAIS via ces outils.
- Pour un envoi réel : invite à cliquer « Postuler » puis « Confirmer et envoyer ».

Langue de reply : {{LANG}}.`;

function heuristicParse(text = '', locale = 'fr') {
  const m = String(text).toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
  const isEn = locale === 'en';

  // Small talk / conversation générale — no tools
  if (
    !/\b(offre|offres|candidature|postul|opportunit|job|apply|navigue|montre|affiche|filtre)\b/.test(m) &&
    /\b(comment (tu|ca|ça) va|ca va|ça va|how are you|how're you|qui es[- ]tu|who are you|bonjour|salut|hello|hi|hey|merci|thanks|thank you|bonne (journee|soirée)|au revoir|bye)\b/.test(
      m
    )
  ) {
    if (/comment (tu|ca|ça) va|ca va\b|ça va\b|how are you/.test(m)) {
      return {
        reply: isEn
          ? "I'm doing well, thanks! Ready to help with jobs or applications — how about you?"
          : 'Ça va bien, merci ! Je suis prêt à t’aider sur les offres ou candidatures. Et toi ?',
        actions: [],
        awaitConfirmation: false
      };
    }
    if (/qui es[- ]tu|who are you/.test(m)) {
      return {
        reply: isEn
          ? "I'm the M-ECAL job assistant for logistics opportunities in the DRC."
          : 'Je suis l’assistant emploi M-ECAL pour la logistique en RDC.',
        actions: [],
        awaitConfirmation: false
      };
    }
    if (/merci|thanks|thank you/.test(m)) {
      return {
        reply: isEn ? "You're welcome!" : 'Avec plaisir !',
        actions: [],
        awaitConfirmation: false
      };
    }
    if (/bonjour|salut|hello|hi|hey/.test(m)) {
      return {
        reply: isEn
          ? 'Hi! How can I help — offers, applications, or something else?'
          : 'Bonjour ! Je peux t’aider sur les offres, les candidatures, ou autre chose ?',
        actions: [],
        awaitConfirmation: false
      };
    }
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

  if (/\b(postule|postuler|apply|candidater|prepare|prépare|preparer|préparer)\b/.test(m) && /\b(candidature|offre|post)\b/.test(m)) {
    const idx = m.match(/\b(?:offre|offer)\s*(?:n[°o.]?\s*)?(\d+)\b/);
    const offerIndex = idx ? Number(idx[1]) - 1 : null;
    const titleMatch = String(text).match(
      /(?:pour|offre)\s+(?:l['’]|la\s+|le\s+)?(.{2,80}?)(?:\s*$|\.|!|\?)/i
    );
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
    if (/assistant|emploi/.test(m)) {
      return {
        reply: isEn ? 'Opening the job assistant.' : 'J’ouvre l’Assistant Emploi.',
        actions: [{ tool: 'naviguerVers', args: { page: 'assistant-emploi' } }],
        awaitConfirmation: false
      };
    }
  }

  return {
    reply: isEn
      ? 'I can chat, show applications, filter opportunities, navigate, or prepare an application (with your confirmation). What do you need?'
      : 'Je peux discuter, afficher les candidatures, filtrer des offres, naviguer, ou préparer une candidature (avec votre confirmation). Que puis-je faire ?',
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

async function executeActions(payload, locale) {
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
      replies.push(
        isEn
          ? `You have ${result.total} application(s)${result.statut ? ` in status ${result.statut}` : ''}.`
          : `Vous avez ${result.total} candidature(s)${result.statut ? ` au statut ${result.statut}` : ''}.`
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
      const created = await createDraftApplication(opp);
      extra.createdApplication = {
        id: String(created.application?._id || ''),
        title: opp.title,
        alreadyExisted: created.alreadyExisted
      };
      extra.toolResults.preparerCandidature = extra.createdApplication;
      replies.push(
        created.alreadyExisted
          ? isEn
            ? `A draft already exists for “${opp.title}”.`
            : `Un brouillon existe déjà pour « ${opp.title} ».`
          : isEn
            ? `Alright, I created a draft application for “${opp.title}”.`
            : `D’accord, j’ai créé une candidature brouillon pour « ${opp.title} ».`
      );
    }
    if (action.tool === 'filtrerOffres' || action.tool === 'afficherOffres') {
      const ville = action.args?.ville;
      replies.push(
        isEn
          ? `Alright, I am filtering the offers${ville ? ` in ${ville}` : ''}.`
          : `D’accord, je filtre les offres${ville ? ` de ${ville}` : ''}.`
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
export async function processVoiceCommand({ text, locale: localeHint } = {}) {
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

  // Prefer fast heuristic for clear small-talk / navigation intents
  if (
    heuristic.actions.length === 0 &&
    /comment (tu|ca|ça) va|ça va|how are you|qui es[- ]tu|bonjour|salut|merci|thanks/i.test(message)
  ) {
    return { ...heuristic, provider: 'heuristic' };
  }

  if (heuristic.actions.length) {
    return executeActions({ ...heuristic, provider: 'heuristic' }, locale);
  }

  try {
    const system = VOICE_AGENT_SYSTEM_PROMPT.replace('{{LANG}}', languageLabel(locale));
    const raw = await callAIForJSON(
      `Commande utilisateur:\n"""${message}"""\n\nRéponds en JSON uniquement.`,
      system
    );
    const payload = sanitizePayload(raw, locale);
    if (!payload.actions.length && heuristic.actions.length) {
      return executeActions({ ...heuristic, reply: payload.reply || heuristic.reply, provider: 'hybrid' }, locale);
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
    return executeActions({ ...payload, provider: 'ai' }, locale);
  } catch (e) {
    logger.warn(`voiceCommand AI fallback: ${e.message}`);
    return executeActions({ ...heuristic, provider: 'heuristic' }, locale);
  }
}
