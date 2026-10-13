import mongoose from 'mongoose';
import Opportunity from '../models/Opportunity.js';
import { callAIText } from './aiService.js';
import { stripMarkdown } from '../utils/stripMarkdown.js';
import logger from '../utils/logger.js';

function formatHistory(messages) {
  if (!Array.isArray(messages)) return '';
  return messages
    .filter((m) => m && (m.role === 'user' || m.role === 'assistant') && m.content)
    .slice(-12)
    .map((m) => `${m.role === 'user' ? 'Utilisateur' : 'Assistant'} : ${String(m.content).slice(0, 2000)}`)
    .join('\n');
}

function localFallbackReply(opp) {
  const desc = String(opp.description || '').trim();
  const excerpt = desc ? desc.slice(0, 900) : 'Aucun texte scrapé n’est stocké pour cette offre.';
  return [
    `Nos assistants IA sont temporairement indisponibles. Voici les faits déjà enregistrés pour cette offre — sans analyse supplémentaire.`,
    ``,
    `**${opp.title}**`,
    `Organisation : ${opp.organization || 'non précisée'}`,
    `Source : ${opp.platform || '—'}`,
    opp.sourceUrl ? `[Ouvrir la source](${opp.sourceUrl})` : '',
    ``,
    `Extrait disponible :`,
    excerpt,
    ``,
    `Je n’invente pas d’e-mail ni de contact hors de cet extrait. Consultez aussi [Opportunités](/opportunities).`
  ]
    .filter((line, idx, arr) => !(line === '' && arr[idx - 1] === ''))
    .join('\n');
}

export async function answerOpportunityQuestion({ id, message, messages = [] }) {
  if (!mongoose.isValidObjectId(id)) {
    const err = new Error('Identifiant d’offre invalide.');
    err.status = 400;
    throw err;
  }
  const opp = await Opportunity.findById(id).lean();
  if (!opp) {
    const err = new Error('Opportunité introuvable.');
    err.status = 404;
    throw err;
  }
  const question = String(message || '').trim();
  if (!question) {
    const err = new Error('Question requise.');
    err.status = 400;
    throw err;
  }

  const intel = opp.applyIntel || {};
  const prompt = `Tu réponds à une question sur UNE offre M-ECAL. Texte brut, sans Markdown.
N'invente JAMAIS d'e-mail, téléphone, nom de contact, date ou pièce absents des FAITS. Si l'info manque, dis-le clairement.

FAITS OFFRE :
- Titre : ${opp.title}
- Organisation : ${opp.organization || '—'}
- Plateforme : ${opp.platform || '—'}
- Ville : ${opp.ville || opp.location || '—'}
- Deadline : ${opp.deadline || 'non précisée'}
- URL : ${opp.sourceUrl || '—'}
- Texte scrapé :
"""${String(opp.description || '').slice(0, 8000)}"""

RECHERCHE CONTACT (peut être vide si l'utilisateur n'a pas cliqué Comment postuler) :
- Méthode : ${intel.method || 'non analysée'}
- E-mails : ${(intel.emails || []).join(', ') || '(aucun)'}
- Portail : ${intel.portalUrl || '(aucun)'}
- Source info : ${intel.sourceLabel || 'analyse non déclenchée'}
- Instructions déjà générées : ${String(intel.instructions || '').slice(0, 2500) || '(pas encore)'}

Historique :
${formatHistory(messages) || '(début)'}

Question actuelle :
${question}`;

  try {
    const raw = await callAIText(
      prompt,
      'Conseiller M-ECAL. Réponds seulement à partir des faits fournis. N’invente aucun contact.',
      1800,
      { mode: 'full' }
    );
    const reply = stripMarkdown(raw);
    if (!reply) {
      throw new Error('Réponse IA vide');
    }
    logger.info(`ask offre ${id}: IA ok (${reply.length} car.)`);
    return { reply, opportunityId: String(opp._id), title: opp.title };
  } catch (e) {
    logger.error(`ask offre ${id} — IA en échec: ${e.message}`);
    logger.error(e.stack || e);
    const reply = localFallbackReply(opp);
    return {
      reply,
      opportunityId: String(opp._id),
      title: opp.title,
      provider: 'local',
      warning: e.message
    };
  }
}

export async function handleOpportunityAsk(req, res, next) {
  try {
    const result = await answerOpportunityQuestion({
      id: req.params.id,
      message: req.body?.message,
      messages: req.body?.messages
    });
    res.json(result);
  } catch (e) {
    logger.error(`POST ask ${req.params.id}: ${e.message}`);
    if (!e.status) e.status = 500;
    next(e);
  }
}
