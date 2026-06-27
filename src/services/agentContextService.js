import Opportunity from '../models/Opportunity.js';
import Application from '../models/Application.js';
import Source from '../models/Source.js';
import User from '../models/User.js';
import { listMessages } from '../services/gmailService.js';

function countUnread(messages = []) {
  return messages.filter((m) => m.unread || m.isRead === false).length;
}

export async function getAgentSystemSnapshot(userId) {
  const [
    totalActive,
    totalArchived,
    applications,
    sources,
    platformAgg,
    recentOpportunities,
    user,
    pendingUsers
  ] = await Promise.all([
    Opportunity.countDocuments({ isArchived: false }),
    Opportunity.countDocuments({ isArchived: true }),
    Application.find().populate('opportunity').sort({ updatedAt: -1 }).limit(50).lean(),
    Source.find().lean(),
    Opportunity.aggregate([
      { $match: { isArchived: false } },
      { $group: { _id: '$platform', count: { $sum: 1 } } },
      { $sort: { count: -1 } }
    ]),
    Opportunity.find({ isArchived: false })
      .sort({ createdAt: -1 })
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

  const enabledSources = sources.filter((s) => s.enabled !== false);

  return {
    stats: {
      opportunitiesActive: totalActive,
      opportunitiesArchived: totalArchived,
      applicationsTotal: applications.length,
      sourcesActive: enabledSources.length,
      sourcesTotal: sources.length,
      pendingUserApprovals: pendingUsers
    },
    platforms,
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
      score: o.aiAnalysis?.score ?? o.aiRelevanceScore,
      sourceUrl: o.sourceUrl
    }))
  };
}
