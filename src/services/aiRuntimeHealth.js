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

const AI_KEY_VARS = ['ANTHROPIC_API_KEY', 'OPENAI_API_KEY', 'GEMINI_API_KEY', 'GROQ_API_KEY'];

/** Vrai si au moins une clé d'IA est configurée. Sans clé, sonder ne sert à rien. */
function anyAiKeyConfigured() {
  return AI_KEY_VARS.some((name) => String(process.env[name] || '').trim());
}

export function markAiDegraded() {
  degraded = true;
  lastFailureAt = new Date().toISOString();
  if (probeTimer) return;
  if (!anyAiKeyConfigured()) {
    // Aucune clé : pas de sondage toutes les 45 s (il échouerait toujours et
    // remplirait les logs). Redémarrer le serveur après avoir ajouté une clé.
    if (!markAiDegraded.noKeyLogged) {
      logger.warn('[IA] Aucune clé API configurée — mode simplifié, sondage désactivé');
      markAiDegraded.noKeyLogged = true;
    }
    return;
  }
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
