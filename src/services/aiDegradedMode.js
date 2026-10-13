import ScrapeLog from '../models/ScrapeLog.js';

const REAL_AI = new Set(['claude', 'gemini', 'groq', 'openai']);
const KEYWORD_STREAK_MIN = 3;

function usageMap(log) {
  const raw = log?.aiProviders;
  if (!raw) return {};
  if (raw instanceof Map) return Object.fromEntries(raw);
  return raw;
}

export function isKeywordOnlyScan(log) {
  if (!log || log.status !== 'success') return false;
  const name = String(log.aiProvider || '').toLowerCase().trim();
  if (REAL_AI.has(name)) return false;
  const usage = usageMap(log);
  if ([...REAL_AI].some((key) => Number(usage[key] || 0) > 0)) return false;
  if (Number(usage.keywords || 0) > 0) return true;
  if (name === 'keywords') return true;
  return Number(log.scoredCount || 0) > 0 && !name;
}

export async function getAiDegradedMode({ minStreak = KEYWORD_STREAK_MIN } = {}) {
  const logs = await ScrapeLog.find({ status: 'success' })
    .sort({ startedAt: -1 })
    .limit(20)
    .select('startedAt finishedAt aiProvider aiProviders scoredCount status')
    .lean();

  let streak = 0;
  let since = null;
  for (const log of logs) {
    if (!isKeywordOnlyScan(log)) break;
    streak += 1;
    since = log.finishedAt || log.startedAt;
  }

  if (streak < minStreak || !since) {
    return { active: false, consecutiveCycles: streak, since: null, sinceHours: 0 };
  }

  const sinceHours = Math.max(0, (Date.now() - new Date(since).getTime()) / 3600000);
  return {
    active: true,
    consecutiveCycles: streak,
    since,
    sinceHours: Number(sinceHours.toFixed(1))
  };
}
