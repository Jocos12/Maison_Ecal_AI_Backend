import logger from '../utils/logger.js';

const PROBE_MS = Number(process.env.AI_RECOVERY_PROBE_MS) || 45000;

let degraded = false;
let lastFailureAt = null;
let lastSuccessAt = null;
let lastSuccessProvider = null;
let probeTimer = null;
let probing = false;

export function getAiRuntimeHealth() {
  return {
    degraded,
    lastFailureAt,
    lastSuccessAt,
    lastSuccessProvider
  };
}

export function markAiSuccess(provider) {
  const wasDegraded = degraded;
  degraded = false;
  lastSuccessAt = new Date().toISOString();
  lastSuccessProvider = provider || lastSuccessProvider;
  if (probeTimer) {
    clearInterval(probeTimer);
    probeTimer = null;
  }
  if (wasDegraded) {
    logger.info(`[IA] Fournisseur de nouveau disponible: ${provider}`);
  }
}

export function markAiDegraded() {
  degraded = true;
  lastFailureAt = new Date().toISOString();
  if (probeTimer) return;
  probeTimer = setInterval(() => {
    probeAiRecovery().catch(() => {});
  }, PROBE_MS);
  logger.info(`[IA] Mode simplifié — nouveau sondage cascade dans ${PROBE_MS / 1000}s`);
}

async function probeAiRecovery() {
  if (probing || !degraded) return;
  probing = true;
  try {
    const { callAIWithFallback } = await import('./aiService.js');
    const result = await callAIWithFallback(
      'Réponds uniquement par le mot OK.',
      'Ping de disponibilité M-ECAL. Un mot suffit.',
      16,
      { mode: 'full', probe: true }
    );
    if (result?.text) markAiSuccess(result.provider);
  } catch {
    logger.info('[IA] Sondage cascade: toujours indisponible');
  } finally {
    probing = false;
  }
}
