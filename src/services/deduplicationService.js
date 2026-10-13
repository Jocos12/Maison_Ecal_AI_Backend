import Opportunity from '../models/Opportunity.js';
import { opportunityFingerprint, normalizeSourceUrl } from './opportunityIdentity.js';

export async function existsByUrl(sourceUrl) {
  const normalized = normalizeSourceUrl(sourceUrl) || sourceUrl;
  const doc = await Opportunity.findOne({
    $or: [{ sourceUrl }, { sourceUrl: normalized }]
  })
    .select('_id')
    .lean();
  return Boolean(doc);
}

export async function findExistingOpportunity({ sourceUrl, title, fingerprint }) {
  const normalized = normalizeSourceUrl(sourceUrl) || sourceUrl;
  const fp = fingerprint || opportunityFingerprint(sourceUrl, title);
  return Opportunity.findOne({
    $or: [{ sourceUrl }, { sourceUrl: normalized }, { fingerprint: fp }]
  });
}

export async function upsertOpportunity(data) {
  const sourceUrl = normalizeSourceUrl(data.sourceUrl) || data.sourceUrl;
  const fingerprint = data.fingerprint || opportunityFingerprint(sourceUrl, data.title);
  const existing = await findExistingOpportunity({
    sourceUrl,
    title: data.title,
    fingerprint
  });

  if (existing) {
    const patch = {
      title: data.title,
      description: data.description,
      organization: data.organization,
      location: data.location,
      category: data.category,
      rawKeywords: data.rawKeywords,
      scrapedAt: new Date(),
      fingerprint,
      sourceUrl,
      deadlineUnspecified: !data.deadline && !existing.deadline
    };
    if (data.deadline) {
      patch.deadline = data.deadline;
      patch.deadlineUnspecified = false;
    }
    if (data.postedDate) patch.postedDate = data.postedDate;
    if (data.locationStatus) patch.locationStatus = data.locationStatus;
    if (data.ville) patch.ville = data.ville;
    if (typeof data.isArchived === 'boolean') patch.isArchived = data.isArchived;
    if (data.isArchived === false) patch.expiredReason = '';
    if (data.expiredReason) patch.expiredReason = data.expiredReason;
    if (data.isUrgent != null) patch.isUrgent = data.isUrgent;
    if (data.aiRelevanceScore != null) patch.aiRelevanceScore = data.aiRelevanceScore;
    if (typeof data.isRecommended === 'boolean') patch.isRecommended = data.isRecommended;
    if (data.aiScoringProvider) patch.aiScoringProvider = data.aiScoringProvider;
    if (data.aiAnalysis) patch.aiAnalysis = data.aiAnalysis;
    if (!existing.firstSeenAt) {
      patch.firstSeenAt = existing.createdAt || new Date();
    }
    await Opportunity.updateOne({ _id: existing._id }, { $set: patch });
    return { created: false, doc: await Opportunity.findById(existing._id) };
  }

  const now = new Date();
  const doc = await Opportunity.create({
    ...data,
    sourceUrl,
    fingerprint,
    firstSeenAt: now,
    deadlineUnspecified: !data.deadline,
    isNew: !data.isArchived
  });
  return { created: true, doc };
}
