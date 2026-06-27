import LoginActivity from '../models/LoginActivity.js';
import User from '../models/User.js';

function clientIp(req) {
  const forwarded = req.headers['x-forwarded-for'];
  if (typeof forwarded === 'string' && forwarded.length) {
    return forwarded.split(',')[0].trim();
  }
  return req.ip || req.socket?.remoteAddress || '';
}

function actorFromUser(user) {
  return {
    userId: user._id,
    email: user.email,
    name: user.name,
    role: user.role
  };
}

export async function recordLoginActivity(req, user, action = 'login') {
  if (!user?._id) return null;

  const entry = await LoginActivity.create({
    ...actorFromUser(user),
    action,
    ip: clientIp(req),
    userAgent: String(req.headers['user-agent'] || '').slice(0, 500)
  });

  if (action === 'login') {
    await User.findByIdAndUpdate(user._id, { lastLoginAt: new Date() });
  }

  return entry;
}

export async function recordAdminActivity(req, adminUser, { action, targetUser = null, details = '' } = {}) {
  if (!adminUser?._id) return null;

  return LoginActivity.create({
    ...actorFromUser(adminUser),
    action,
    targetUserId: targetUser?._id || null,
    targetEmail: targetUser?.email || '',
    details: details.slice(0, 500),
    ip: clientIp(req),
    userAgent: String(req.headers['user-agent'] || '').slice(0, 500)
  });
}

export async function getRecentActivity(limit = 20) {
  const rows = await LoginActivity.find()
    .sort({ createdAt: -1 })
    .limit(Math.min(Math.max(Number(limit) || 20, 1), 100))
    .lean();

  return rows.map((row) => ({
    id: row._id,
    userId: row.userId,
    email: row.email,
    name: row.name,
    role: row.role,
    action: row.action,
    targetUserId: row.targetUserId,
    targetEmail: row.targetEmail,
    details: row.details,
    ip: row.ip,
    userAgent: row.userAgent,
    createdAt: row.createdAt
  }));
}
