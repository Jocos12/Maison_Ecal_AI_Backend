import Opportunity from '../models/Opportunity.js';
import Application from '../models/Application.js';
import { activeOpportunityFilter } from './opportunityLifecycle.js';

const CITIES = ['Kinshasa', 'Goma', 'Bukavu', 'Kalemie', 'Lubumbashi'];

export function detectCity(text = '') {
  const m = String(text).toLowerCase();
  return CITIES.find((c) => m.includes(c.toLowerCase())) || '';
}

function cityQuery(ville) {
  const re = new RegExp(ville.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i');
  return {
    $or: [{ ville: re }, { location: re }, { organization: re }, { title: re }]
  };
}

export async function countOpportunities({ ville, today, search } = {}) {
  const parts = [{ isArchived: { $ne: true } }];
  if (ville) parts.push(cityQuery(ville));
  if (search) {
    const re = new RegExp(String(search).replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i');
    parts.push({ $or: [{ title: re }, { description: re }, { organization: re }] });
  }
  if (today) {
    const start = new Date();
    start.setHours(0, 0, 0, 0);
    parts.push({
      $or: [
        { postedDate: { $gte: start } },
        { firstSeenAt: { $gte: start } },
        { createdAt: { $gte: start } },
        { scrapedAt: { $gte: start } }
      ]
    });
  }
  const filter = parts.length === 1 ? parts[0] : { $and: parts };
  const count = await Opportunity.countDocuments(filter);
  return { count, filter: { ville: ville || null, today: Boolean(today), search: search || null } };
}

export async function listApplications({ statut } = {}) {
  const q = {};
  if (statut) {
    if (statut === 'pending') q.status = { $in: ['pending', 'interview'] };
    else q.status = statut;
  }
  const apps = await Application.find(q).populate('opportunity', 'title organization ville').sort({ updatedAt: -1 }).limit(40).lean();
  const total = await Application.countDocuments(q);
  return {
    total,
    statut: statut || null,
    items: apps.map((a) => ({
      id: String(a._id),
      status: a.status,
      title: a.opportunity?.title || '',
      organization: a.opportunity?.organization || ''
    }))
  };
}

/** Active offers for a spoken answer. mecalFit = strict M-ECAL métier confirmé. */
export async function listMatchingOpportunities({ ville, search, mecalFit, limit = 6 } = {}) {
  const parts = [activeOpportunityFilter()];
  if (ville) parts.push(cityQuery(ville));
  if (search) {
    const re = new RegExp(String(search).replace(/[.*+?^${}()|[\]\\]/g, '\\$&').slice(0, 80), 'i');
    parts.push({ $or: [{ title: re }, { organization: re }, { description: re }] });
  }
  if (mecalFit) {
    parts.push({
      $or: [
        { 'strictMecalMatch.status': 'metier_confirme' },
        { isRecommended: true },
        { aiRelevanceScore: { $gte: 0.55 } }
      ]
    });
  }
  const filter = { $and: parts };
  const cap = Math.min(Number(limit) || 6, 8);
  const [total, rows] = await Promise.all([
    Opportunity.countDocuments(filter),
    Opportunity.find(filter)
      .sort({ deadline: 1, aiRelevanceScore: -1 })
      .limit(cap)
      .select('title organization ville platform')
      .lean()
  ]);
  let review = 0;
  if (mecalFit && total === 0) {
    review = await Opportunity.countDocuments(
      activeOpportunityFilter({ 'strictMecalMatch.status': 'a_verifier' })
    );
  }
  return {
    total,
    review,
    items: rows.map((o) => ({
      title: o.title,
      organization: o.organization || o.platform || '',
      ville: o.ville || ''
    }))
  };
}

export async function findOpportunityByHint({ offreId, title, search } = {}) {
  if (offreId) {
    const one = await Opportunity.findById(offreId).lean();
    if (one) return one;
  }
  const q = String(title || search || '').trim();
  if (!q) {
    return Opportunity.findOne({ isArchived: { $ne: true } }).sort({ aiRelevanceScore: -1, deadline: 1 }).lean();
  }
  const re = new RegExp(q.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').slice(0, 80), 'i');
  return Opportunity.findOne({
    isArchived: { $ne: true },
    $or: [{ title: re }, { organization: re }]
  }).lean();
}

export async function createDraftApplication(opp, notes) {
  if (!opp?._id) return { created: false, alreadyExisted: false, application: null };
  const existing = await Application.findOne({ opportunity: opp._id }).populate('opportunity').lean();
  if (existing) {
    return { created: false, alreadyExisted: true, application: existing };
  }
  const doc = await Application.create({
    opportunity: opp._id,
    status: 'draft',
    notes: notes || `Brouillon préparé — ${opp.title}`
  });
  const populated = await doc.populate('opportunity');
  return { created: true, alreadyExisted: false, application: populated.toObject() };
}
