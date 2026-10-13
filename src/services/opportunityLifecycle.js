import { NEW_OPPORTUNITY_DAYS, STALE_NO_DEADLINE_DAYS } from '../config/constants.js';
import Opportunity from '../models/Opportunity.js';
import { isDeadlineExpired, startOfTodayKinshasa } from '../scrapers/dateExtract.js';
import { opportunityFingerprint, normalizeSourceUrl } from './opportunityIdentity.js';
import logger from '../utils/logger.js';

export async function archiveExpiredOpportunities() {
  const cutoff = startOfTodayKinshasa();
  const result = await Opportunity.updateMany(
    {
      isArchived: false,
      deadline: { $ne: null, $lt: cutoff }
    },
    {
      $set: {
        isArchived: true,
        isNew: false,
        expiredReason: 'deadline_passed'
      }
    }
  );
  if (result.modifiedCount) {
    logger.info(`Archived ${result.modifiedCount} expired opportunities (deadline < ${cutoff.toISOString()})`);
  }
  return result.modifiedCount || 0;
}

export async function archiveStaleWithoutDeadline() {
  const days = STALE_NO_DEADLINE_DAYS;
  const cutoff = new Date(Date.now() - days * 24 * 60 * 60 * 1000);
  const result = await Opportunity.updateMany(
    {
      isArchived: false,
      $and: [
        { $or: [{ deadline: null }, { deadline: { $exists: false } }] },
        {
          $or: [
            { postedDate: { $lt: cutoff } },
            {
              $and: [
                { $or: [{ postedDate: null }, { postedDate: { $exists: false } }] },
                { firstSeenAt: { $lt: cutoff } }
              ]
            },
            {
              $and: [
                { $or: [{ postedDate: null }, { postedDate: { $exists: false } }] },
                { $or: [{ firstSeenAt: null }, { firstSeenAt: { $exists: false } }] },
                { createdAt: { $lt: cutoff } }
              ]
            }
          ]
        }
      ]
    },
    {
      $set: {
        isArchived: true,
        isNew: false,
        expiredReason: 'stale_no_deadline'
      }
    }
  );
  if (result.modifiedCount) {
    logger.info(
      `Archived ${result.modifiedCount} stale opportunities without deadline (older than ${days} days)`
    );
  }
  return result.modifiedCount || 0;
}

export async function archiveInactiveOpportunities() {
  const archivedExpired = await archiveExpiredOpportunities();
  const archivedStale = await archiveStaleWithoutDeadline();
  return {
    archivedExpired,
    archivedStale,
    archivedTotal: archivedExpired + archivedStale
  };
}

export function newOpportunityCutoff(days = NEW_OPPORTUNITY_DAYS) {
  return new Date(Date.now() - days * 24 * 60 * 60 * 1000);
}

export function computeIsNewFromFirstSeen(firstSeenAt, createdAt, days = NEW_OPPORTUNITY_DAYS) {
  const first = firstSeenAt || createdAt;
  if (!first) return false;
  return new Date(first).getTime() >= newOpportunityCutoff(days).getTime();
}

export async function freezeAndSyncNewFlags() {
  const cutoff = newOpportunityCutoff();
  const missing = await Opportunity.find({
    $or: [{ firstSeenAt: null }, { firstSeenAt: { $exists: false } }]
  })
    .select('_id createdAt')
    .lean();

  for (const doc of missing) {
    if (!doc.createdAt) continue;
    await Opportunity.updateOne(
      { _id: doc._id, $or: [{ firstSeenAt: null }, { firstSeenAt: { $exists: false } }] },
      { $set: { firstSeenAt: doc.createdAt } }
    );
  }

  const [cleared, marked] = await Promise.all([
    Opportunity.updateMany(
      {
        isNew: true,
        firstSeenAt: { $lt: cutoff }
      },
      { $set: { isNew: false } }
    ),
    Opportunity.updateMany(
      {
        isNew: { $ne: true },
        isArchived: false,
        firstSeenAt: { $gte: cutoff }
      },
      { $set: { isNew: true } }
    )
  ]);

  return {
    days: NEW_OPPORTUNITY_DAYS,
    backfilledFirstSeen: missing.length,
    cleared: cleared.modifiedCount || 0,
    marked: marked.modifiedCount || 0
  };
}

export async function clearStaleNewFlags() {
  const result = await freezeAndSyncNewFlags();
  return result.cleared;
}

export async function backfillFingerprints(limit = 400) {
  const missing = await Opportunity.find({
    $or: [{ fingerprint: { $exists: false } }, { fingerprint: null }, { fingerprint: '' }]
  })
    .select('sourceUrl title firstSeenAt createdAt')
    .limit(limit)
    .lean();

  let updated = 0;
  for (const doc of missing) {
    const fingerprint = opportunityFingerprint(doc.sourceUrl, doc.title);
    const sourceUrl = normalizeSourceUrl(doc.sourceUrl) || doc.sourceUrl;
    const patch = { fingerprint, sourceUrl };
    if (!doc.firstSeenAt && doc.createdAt) patch.firstSeenAt = doc.createdAt;
    try {
      await Opportunity.updateOne({ _id: doc._id }, { $set: patch });
      updated++;
    } catch (e) {
      if (e.code !== 11000) logger.warn(`fingerprint backfill ${doc._id}: ${e.message}`);
    }
  }
  return updated;
}

export function deadlineStillOpenClause(cutoff = startOfTodayKinshasa()) {
  return { $or: [{ deadline: { $exists: false } }, { deadline: null }, { deadline: { $gte: cutoff } }] };
}

export function activeOpportunityFilter(extra = {}) {
  const clauses = [{ isArchived: false }, deadlineStillOpenClause()];
  if (extra && Object.keys(extra).length) clauses.push(extra);
  return { $and: clauses };
}

export { isDeadlineExpired, startOfTodayKinshasa };
