/** Taux de pertinence M-ECAL à partir des compteurs d’un scan — aucun recalcul de score. */

export const PRIMARY_SKIP_KEYS = ['not_mecal_service', 'non_logistics', 'job_posting', 'hors_rdc', 'not_a_tender'];

export function roundPct(value) {
  if (value == null || Number.isNaN(Number(value))) return null;
  return Math.round(Number(value) * 10) / 10;
}

export function ratioPct(num, den) {
  const n = Number(num) || 0;
  const d = Number(den) || 0;
  if (d <= 0) return null;
  return roundPct((n / d) * 100);
}

export function skipReasonsToObject(skipReasons) {
  if (!skipReasons) return {};
  if (skipReasons instanceof Map) return Object.fromEntries(skipReasons);
  if (typeof skipReasons.toObject === 'function') return skipReasons.toObject();
  return { ...skipReasons };
}

export function computeScanRelevanceRates(log = {}) {
  const read = Number(log.totalRaw ?? 0);
  const skipped = Number(log.skipped ?? 0);
  const kept = Math.max(0, read - skipped);
  const scored = Number(log.scoredCount ?? 0);
  const recommended = Number(log.recommendedCount ?? 0);
  const skipObj = skipReasonsToObject(log.skipReasons);

  const skipReasons = Object.entries(skipObj)
    .filter(([, count]) => Number(count) > 0)
    .map(([key, count]) => ({
      key,
      count: Number(count) || 0,
      pct: ratioPct(count, read)
    }))
    .sort((a, b) => b.count - a.count);

  const skipReasonPercents = Object.fromEntries(
    skipReasons.map((row) => [row.key, row.pct])
  );

  return {
    read,
    kept,
    skipped,
    scored,
    recommended,
    filterRetentionPct: ratioPct(kept, read),
    relevancePct: ratioPct(recommended, scored),
    globalRelevancePct: ratioPct(recommended, read),
    skipReasons,
    skipReasonPercents
  };
}

export function averageScanRelevance(logs = []) {
  const rows = (logs || []).map((log) => computeScanRelevanceRates(log));
  const mean = (pick) => {
    const vals = rows.map(pick).filter((v) => v != null);
    if (!vals.length) return null;
    return roundPct(vals.reduce((s, v) => s + v, 0) / vals.length);
  };
  return {
    scanCount: rows.length,
    filterRetentionPct: mean((r) => r.filterRetentionPct),
    relevancePct: mean((r) => r.relevancePct),
    globalRelevancePct: mean((r) => r.globalRelevancePct)
  };
}

export function buildMarketRelevancePayload({ lastSuccessLog, rollingLogs, threshold }) {
  const last = lastSuccessLog ? computeScanRelevanceRates(lastSuccessLog) : null;
  return {
    threshold,
    lastScan: last
      ? {
          startedAt: lastSuccessLog.startedAt || null,
          finishedAt: lastSuccessLog.finishedAt || null,
          ...last
        }
      : null,
    rolling10: averageScanRelevance(rollingLogs)
  };
}

export function ratesForScrapeLogPersist(logLike) {
  const r = computeScanRelevanceRates(logLike);
  return {
    filterRetentionPct: r.filterRetentionPct,
    relevancePct: r.relevancePct,
    globalRelevancePct: r.globalRelevancePct,
    skipReasonPercents: r.skipReasonPercents
  };
}
