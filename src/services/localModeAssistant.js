import Opportunity from '../models/Opportunity.js';
import Application from '../models/Application.js';
import JobApplicationLog from '../models/JobApplicationLog.js';
import { activeOpportunityFilter } from './opportunityLifecycle.js';
import { extractSearchParams, RDC_CITIES } from './jobContextService.js';

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
    return [
      intro(locale),
      '',
      'I cannot analyse this request without AI. Meanwhile you can:',
      '- Open **[Opportunities](/opportunities)** to browse active listings',
      '- Open **[Applications](/applications)** to check follow-up',
      '- Open **[Job assistant](/assistant-emploi)** for CV / letters once AI is back',
      '',
      'I will use the full AI cascade again as soon as a provider responds.'
    ].join('\n');
  }
  return [
    intro(locale),
    '',
    'Je ne peux pas analyser cette demande en ce moment, mais vous pouvez consulter directement :',
    '- la page **[Opportunités](/opportunities)**',
    '- la page **[Candidatures](/applications)**',
    '- l’**[Assistant Emploi](/assistant-emploi)** pour CV et lettres dès que l’IA revient',
    '',
    'La cascade IA sera réessayée automatiquement dès qu’un fournisseur répondra.'
  ].join('\n');
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
