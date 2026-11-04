import Opportunity from '../models/Opportunity.js';
import Application from '../models/Application.js';
import JobApplicationLog from '../models/JobApplicationLog.js';
import { activeOpportunityFilter } from './opportunityLifecycle.js';
import { extractSearchParams, RDC_CITIES } from './jobContextService.js';
import { listMatchingOpportunities } from './voiceToolRuntime.js';

const SOURCE_ALIASES = [
  { label: 'ReliefWeb', keys: ['reliefweb', 'relief web'], platforms: ['ReliefWeb'] },
  { label: 'UNGM', keys: ['ungm'], platforms: ['UNGM'] },
  { label: 'UNjobs', keys: ['unjobs', 'un jobs', 'unjob'], platforms: ['UNjobs'] },
  {
    label: 'ARMP',
    keys: ['armp', 'achatpublic', 'achat public', 'marche public'],
    platforms: ['AchatPublicRDC', 'SIGMAP']
  },
  { label: 'ARSP', keys: ['arsp'], platforms: ['ARSP'] },
  { label: 'SIGMAP', keys: ['sigmap'], platforms: ['SIGMAP'] },
  { label: 'ProfilRDC', keys: ['profilrdc', 'profil rdc'], platforms: ['ProfilRDC'] },
  { label: 'DevEx', keys: ['devex'], platforms: ['DevEx'] },
  { label: 'HDX', keys: ['hdx'], platforms: ['HDX'] },
  { label: 'World Bank', keys: ['worldbank', 'world bank', 'banque mondiale'], platforms: ['WorldBank'] },
  { label: 'AfDB', keys: ['afdb', 'banque africaine'], platforms: ['AfDB'] }
];

const COUNT_INTENT =
  /combien|nombre|total|how many|how much|ngapi|kiasi/i;
const APP_INTENT = /candidature|postulation|application/i;
const SHORT_FOLLOWUP =
  /^(oui|ok|okay|oké|d['’]accord|yes|yeah|yep|svp|s['’]il te pla[iî]t|please|et après|ensuite|continue|vas-y|d'acc)[\s.!?]*$/i;

function lower(text = '') {
  return String(text || '').toLowerCase();
}

function detectSource(text = '') {
  const t = lower(text);
  return SOURCE_ALIASES.find((alias) => alias.keys.some((key) => t.includes(key))) || null;
}

function collectTexts(messages = [], lastUser = '') {
  return [...messages.map((m) => m.content || ''), lastUser].filter(Boolean);
}

export function extractLocalTopic(messages = [], lastUser = '') {
  const params = extractSearchParams(messages, lastUser);
  const followUp = SHORT_FOLLOWUP.test(String(lastUser).trim());
  const sourceNow = detectSource(lastUser);
  const sourceHist = detectSource(collectTexts(messages, lastUser).join('\n'));
  return {
    city: params.city,
    role: params.role,
    source: sourceNow || (followUp ? sourceHist : null),
    followUp,
    allRdc: params.allRdc || /\brdc\b|rd congo|\bdrc\b/.test(lower(lastUser))
  };
}

function formatOfferLine(o, i) {
  const place = o.ville && o.ville !== 'Non précisé' ? o.ville : o.location || 'RDC';
  const url = o.sourceUrl ? ` — [ouvrir](${o.sourceUrl})` : '';
  return `${i + 1}. **${o.title}** — ${o.organization || o.platform || '—'} (${place}, ${o.platform || 'source'})${url}`;
}

function intro(locale, understood) {
  const understoodLine = understood
    ? locale === 'en'
      ? `You were looking at: **${understood}**. `
      : `Vous cherchiez : **${understood}**. `
    : '';
  if (locale === 'en') {
    return `${understoodLine}Our AI assistants are temporarily busy or unavailable. I can still use data already stored in M-ECAL.`;
  }
  return `${understoodLine}Nos assistants IA sont temporairement surchargés ou indisponibles. Je peux quand même m’appuyer sur les informations déjà en base.`;
}

function navFallback(locale) {
  if (locale === 'en') {
    return "I can't answer that precisely right now. Active listings are on the Opportunities page.";
  }
  return 'Je ne peux pas répondre précisément à cette demande pour le moment. Les offres déjà collectées sont sur la page Opportunités.';
}

/**
 * Direct answers for questions the agent must not turn into a capability menu.
 * Returns null when the question should go to the model.
 */
export async function tryDirectAnswer({ lastUser = '', locale = 'fr' } = {}) {
  const t = lower(lastUser).normalize('NFD').replace(/[\u0300-\u036f]/g, '');
  const en = locale === 'en';

  if (/\b(comment (tu|ca) vas?\b|how are you|ca va\b)/.test(t)) {
    return {
      reply: en ? "I'm doing well, thanks. And you?" : 'Ça va bien, merci. Et toi ?',
      provider: 'local'
    };
  }

  if (/\b(telephone|phone|call me|m'appeler|m appeler)\b/.test(t) && !/\b(offre|candidature|postul)\b/.test(t)) {
    return {
      reply: en ? "I can't call you on the phone." : 'Je ne peux pas vous appeler au téléphone.',
      provider: 'local'
    };
  }

  if (
    /\b(offre|offres|opportunit)\b/.test(t) &&
    /(cadr|correspond|m-?ecal|maison\s*ecal)/.test(t) &&
    !/\bpostul/.test(t)
  ) {
    const result = await listMatchingOpportunities({ mecalFit: true, limit: 8 });
    if (!result.items.length) {
      const alt = result.review
        ? en
          ? ` ${result.review} still need a review.`
          : ` ${result.review} sont encore à vérifier.`
        : '';
      return {
        reply:
          (en
            ? 'No active offer currently fits M-ECAL.'
            : 'Aucune offre active ne cadre avec M-ECAL pour le moment.') + alt,
        provider: 'local'
      };
    }
    const lines = result.items.map(
      (o, i) => `${i + 1}. **${o.title}** — ${o.organization || '—'}${o.ville ? ` (${o.ville})` : ''}`
    );
    return {
      reply:
        (en
          ? `**${result.total}** active offer${result.total > 1 ? 's' : ''} fit M-ECAL:\n\n`
          : `**${result.total}** offre${result.total > 1 ? 's' : ''} active${result.total > 1 ? 's' : ''} ${result.total > 1 ? 'cadrent' : 'cadre'} avec M-ECAL :\n\n`) + lines.join('\n'),
      provider: 'local'
    };
  }

  if (/\b(combien|nombre|how many)\b/.test(t) && /\bcandidature|application/.test(t)) {
    const pending = /attente|pending/.test(t);
    const n = await Application.countDocuments(pending ? { status: { $in: ['pending', 'interview'] } } : {});
    return {
      reply: pending
        ? en
          ? `**${n}** application(s) are pending.`
          : `**${n}** candidature(s) sont en attente.`
        : en
          ? `**${n}** application(s) in total.`
          : `**${n}** candidature(s) au total.`,
      provider: 'local'
    };
  }

  return null;
}

function filterConversationJobs(jobs = [], { city, source }) {
  return (jobs || []).filter((job) => {
    const blob = `${job.city || ''} ${job.location || ''} ${job.title || ''} ${job.platform || ''} ${job.source || ''}`.toLowerCase();
    if (city && !blob.includes(city.toLowerCase())) return false;
    if (source && !source.keys.some((k) => blob.includes(k)) && !source.platforms.some((p) => blob.includes(p.toLowerCase()))) {
      return false;
    }
    return true;
  });
}

async function queryOpportunities({ city, source, limit = 8 }) {
  const extra = {};
  if (source?.platforms?.length) {
    extra.platform = { $in: source.platforms };
  }
  if (city) {
    const rx = new RegExp(city.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i');
    extra.$or = [{ ville: city }, { location: rx }, { title: rx }, { 'aiAnalysis.ville_confirmee': rx }];
  }
  return Opportunity.find(activeOpportunityFilter(extra))
    .sort({ postedDate: -1, scrapedAt: -1 })
    .limit(limit)
    .select('title organization platform ville location sourceUrl deadline')
    .lean();
}

async function queryCounts(userId) {
  const [opportunitiesActive, applications, jobLogs] = await Promise.all([
    Opportunity.countDocuments(activeOpportunityFilter()),
    Application.countDocuments(),
    userId
      ? JobApplicationLog.countDocuments({ userId })
      : JobApplicationLog.countDocuments()
  ]);
  return { opportunitiesActive, applications, jobLogs };
}

function wantsGeo(lastUser, topic) {
  const t = lower(lastUser);
  if (topic.city && (topic.followUp || RDC_CITIES.some((c) => t.includes(c)) || /ville|à |au |bukavu|goma|kinshasa/.test(t))) {
    return true;
  }
  if (topic.city && /offre|emploi|poste|mission/.test(t)) return true;
  return Boolean(topic.city && (topic.followUp || t.split(/\s+/).length <= 6));
}

export async function answerInLocalMode({
  messages = [],
  lastUser = '',
  locale = 'fr',
  userId = null,
  knownJobs = []
} = {}) {
  const topic = extractLocalTopic(messages, lastUser);
  const understood = [topic.city, topic.source?.label, topic.role].filter(Boolean).join(' · ');

  try {
    if (COUNT_INTENT.test(lastUser)) {
      const counts = await queryCounts(userId);
      const focusApps = APP_INTENT.test(lastUser);
      const lines = [
        intro(locale, understood),
        '',
        locale === 'en' ? '**Figures from our database (no AI):**' : '**Chiffres issus de notre base (sans IA) :**',
        locale === 'en'
          ? `- **${counts.opportunitiesActive}** active opportunities`
          : `- **${counts.opportunitiesActive}** opportunité(s) active(s)`,
        locale === 'en'
          ? `- **${counts.applications}** tracked application file(s)`
          : `- **${counts.applications}** dossier(s) de candidature suivis`,
        userId
          ? locale === 'en'
            ? `- **${counts.jobLogs}** job application(s) sent from your account`
            : `- **${counts.jobLogs}** candidature(s) emploi envoyée(s) depuis votre compte`
          : null
      ].filter(Boolean);
      if (focusApps) {
        lines.push(
          '',
          locale === 'en'
            ? 'Details: [Applications](/applications).'
            : 'Détail : [Candidatures](/applications).'
        );
      } else {
        lines.push(
          '',
          locale === 'en'
            ? 'Browse: [Opportunities](/opportunities).'
            : 'Consulter : [Opportunités](/opportunities).'
        );
      }
      return { reply: lines.join('\n'), jobs: [], provider: 'local', topic };
    }

    const sourceAsk = detectSource(lastUser) || (topic.followUp ? topic.source : null);
    if (sourceAsk || (topic.source && /offre|source|reliefweb|armp/.test(lower(lastUser)))) {
      const source = sourceAsk || topic.source;
      const rows = await queryOpportunities({ source, city: topic.city, limit: 8 });
      const conv = filterConversationJobs(knownJobs, { source });
      const lines = [
        intro(locale, source.label + (topic.city ? ` · ${topic.city}` : '')),
        '',
        locale === 'en'
          ? `**Active listings for ${source.label} in our database:**`
          : `**Offres actives ${source.label} dans notre base :**`
      ];
      if (!rows.length && !conv.length) {
        lines.push(
          locale === 'en'
            ? `No active ${source.label} listing right now. See [Opportunities](/opportunities).`
            : `Aucune offre active ${source.label} pour le moment. Voir [Opportunités](/opportunities).`
        );
        return { reply: lines.join('\n'), jobs: conv, provider: 'local', topic };
      }
      lines.push(...rows.map((o, i) => formatOfferLine(o, i)));
      return { reply: lines.join('\n'), jobs: conv.slice(0, 8), provider: 'local', topic };
    }

    if (wantsGeo(lastUser, topic) && topic.city) {
      const rows = await queryOpportunities({ city: topic.city, limit: 8 });
      const conv = filterConversationJobs(knownJobs, { city: topic.city });
      const lines = [
        intro(locale, topic.city),
        '',
        locale === 'en'
          ? `**Active listings matching ${topic.city}:**`
          : `**Offres actives correspondant à ${topic.city} :**`
      ];
      if (!rows.length && !conv.length) {
        lines.push(
          locale === 'en'
            ? `Nothing active for ${topic.city} in the database. Try [Opportunities](/opportunities).`
            : `Rien d’actif pour ${topic.city} dans la base. Consultez [Opportunités](/opportunities).`
        );
        return { reply: lines.join('\n'), jobs: [], provider: 'local', topic };
      }
      lines.push(...rows.map((o, i) => formatOfferLine(o, i)));
      if (conv.length) {
        lines.push(
          '',
          locale === 'en'
            ? 'Also already shown in this chat:'
            : 'Déjà affichées dans cette conversation :',
          ...conv.slice(0, 5).map((j, i) => `${i + 1}. **${j.title}** — ${j.organization || '—'} (${j.city || ''})`)
        );
      }
      return { reply: lines.join('\n'), jobs: conv.slice(0, 8), provider: 'local', topic };
    }

    if (knownJobs.length && /offre|ces postes|celles affich|les cartes/i.test(lastUser)) {
      const lines = [
        intro(locale, understood),
        '',
        locale === 'en'
          ? 'I can only reuse listings already in this chat:'
          : 'Je ne peux réutiliser que les offres déjà présentes dans cette conversation :',
        ...knownJobs.slice(0, 8).map((j, i) => `${i + 1}. **${j.title}** — ${j.organization || '—'} (${j.city || ''})`)
      ];
      return { reply: lines.join('\n'), jobs: knownJobs.slice(0, 8), provider: 'local', topic };
    }
  } catch (err) {
    return {
      reply: navFallback(locale),
      jobs: [],
      provider: 'local',
      topic,
      error: err.message
    };
  }

  return { reply: navFallback(locale), jobs: [], provider: 'local', topic };
}
