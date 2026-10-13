import Opportunity from '../models/Opportunity.js';
import Application from '../models/Application.js';
import Source from '../models/Source.js';
import User from '../models/User.js';
import { listMessages } from '../services/gmailService.js';
import { activeOpportunityFilter } from './opportunityLifecycle.js';

function countUnread(messages = []) {
  return messages.filter((m) => m.unread || m.isRead === false).length;
}

export async function getAgentSystemSnapshot(userId) {
  const active = activeOpportunityFilter();
  const twoWeeksAgo = new Date(Date.now() - 14 * 24 * 60 * 60 * 1000);
  const [
    totalActive,
    totalArchived,
    applications,
    sources,
    platformAgg,
    categoryAgg,
    recommendedCount,
    last14Days,
    recentOpportunities,
    user,
    pendingUsers
  ] = await Promise.all([
    Opportunity.countDocuments(active),
    Opportunity.countDocuments({ isArchived: true }),
    Application.find().populate('opportunity').sort({ updatedAt: -1 }).limit(50).lean(),
    Source.find().lean(),
    Opportunity.aggregate([
      { $match: active },
      { $group: { _id: '$platform', count: { $sum: 1 } } },
      { $sort: { count: -1 } }
    ]),
    Opportunity.aggregate([
      { $match: active },
      { $group: { _id: '$category', count: { $sum: 1 } } },
      { $sort: { count: -1 } }
    ]),
    Opportunity.countDocuments(activeOpportunityFilter({ isRecommended: true })),
    Opportunity.countDocuments({
      $and: [active, { createdAt: { $gte: twoWeeksAgo } }]
    }),
    Opportunity.find(active)
      .sort({ isRecommended: -1, aiRelevanceScore: -1, deadline: 1 })
      .limit(80)
      .lean(),
    User.findById(userId).select('name email role alertsEnabled').lean(),
    User.countDocuments({ isApproved: false })
  ]);

  let gmail = { connected: false, unread: 0, total: 0, userEmail: null };
  try {
    const messages = await listMessages(userId, { maxResults: 50 });
    gmail = {
      connected: true,
      unread: countUnread(messages),
      total: messages.length,
      userEmail: null
    };
  } catch {
    gmail.connected = false;
  }

  const appsByStatus = {};
  for (const a of applications) {
    appsByStatus[a.status] = (appsByStatus[a.status] || 0) + 1;
  }

  const platforms = platformAgg.map((p) => ({
    name: p._id || 'Inconnu',
    count: p.count
  }));

  const categories = categoryAgg.map((c) => ({
    name: c._id || 'sans catégorie',
    count: c.count
  }));

  const enabledSources = sources.filter((s) => s.enabled !== false);

  const appliedSet = new Set(
    applications.map((a) => String(a.opportunity?._id || a.opportunity || '')).filter(Boolean)
  );

  return {
    stats: {
      opportunitiesActive: totalActive,
      opportunitiesArchived: totalArchived,
      applicationsTotal: applications.length,
      sourcesActive: enabledSources.length,
      sourcesTotal: sources.length,
      pendingUserApprovals: pendingUsers,
      recommended: recommendedCount,
      last14Days
    },
    platforms,
    categories,
    sources: enabledSources.map((s) => ({
      name: s.name || s.platform,
      platform: s.platform,
      enabled: s.enabled !== false,
      lastScrapeAt: s.lastScrapeAt
    })),
    applicationsByStatus: appsByStatus,
    gmail,
    user: user
      ? { name: user.name, email: user.email, role: user.role, alertsEnabled: user.alertsEnabled }
      : null,
    recentOpportunities: recentOpportunities.map((o) => ({
      id: o._id,
      title: o.title,
      organization: o.organization,
      platform: o.platform,
      ville: o.ville,
      deadline: o.deadline,
      postedDate: o.postedDate || o.firstSeenAt || o.createdAt,
      isRecommended: Boolean(o.isRecommended),
      category: o.category,
      score: o.aiAnalysis?.score ?? o.aiRelevanceScore,
      sourceUrl: o.sourceUrl,
      hasApplication: appliedSet.has(String(o._id)),
      daysToDeadline: o.deadline
        ? Math.ceil((new Date(o.deadline).getTime() - Date.now()) / 86400000)
        : null
    }))
  };
}
