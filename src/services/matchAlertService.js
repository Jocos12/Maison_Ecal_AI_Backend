import MatchAlert from '../models/MatchAlert.js';
import { HIGH_RELEVANCE_THRESHOLD } from '../config/constants.js';
import logger from '../utils/logger.js';

export function isEcalRelevantMatch(match = {}, doc = {}) {
  if (match.recommended === true || doc.isRecommended === true) return true;
  const score = Number(match.score ?? doc.aiRelevanceScore ?? 0);
  return score >= HIGH_RELEVANCE_THRESHOLD;
}

export async function recordEcalMatchAlert({ doc, match }) {
  if (!doc?._id || !isEcalRelevantMatch(match, doc)) return null;
  try {
    const existing = await MatchAlert.findOne({ opportunity: doc._id }).select('_id').lean();
    if (existing) return existing;
    return await MatchAlert.create({
      opportunity: doc._id,
      title: doc.title || 'Offre',
      organization: doc.organization || '',
      matchReason: String(match?.justification || doc.aiAnalysis?.justification || '').slice(0, 400),
      score: Number(match?.score ?? doc.aiRelevanceScore ?? 0)
    });
  } catch (e) {
    if (e.code !== 11000) logger.warn(`MatchAlert: ${e.message}`);
    return null;
  }
}

export async function listMatchAlerts({ unreadOnly = false, limit = 30 } = {}) {
  const q = unreadOnly ? { readAt: null } : {};
  return MatchAlert.find(q).sort({ createdAt: -1 }).limit(Math.min(80, Number(limit) || 30)).lean();
}

export async function markMatchAlertRead(id) {
  return MatchAlert.findByIdAndUpdate(id, { $set: { readAt: new Date() } }, { new: true });
}

export async function markAllMatchAlertsRead() {
  const res = await MatchAlert.updateMany({ readAt: null }, { $set: { readAt: new Date() } });
  return { modified: res.modifiedCount ?? 0 };
}

export async function dismissMatchAlertsForOpportunity(opportunityId) {
  if (!opportunityId) return { modified: 0 };
  const res = await MatchAlert.updateMany(
    { opportunity: opportunityId, readAt: null },
    { $set: { readAt: new Date() } }
  );
  return { modified: res.modifiedCount ?? 0 };
}
