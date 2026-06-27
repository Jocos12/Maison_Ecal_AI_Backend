import axios from 'axios';
import https from 'https';
import logger from '../utils/logger.js';

function getErrorMessage(err) {
  return err.response?.data?.error?.message || err.response?.data?.message || err.message;
}

function isProviderConfigured(name) {
  const keyMap = {
    claude: 'ANTHROPIC_API_KEY',
    groq: 'GROQ_API_KEY',
    gemini: 'GEMINI_API_KEY'
  };
  return Boolean(process.env[keyMap[name]]?.trim());
}

/** Rate limit, quota, or capacity errors — should cascade to next provider. */
function isRateLimitOrQuotaError(err) {
  const status = err.response?.status;
  const msg = getErrorMessage(err);
  return (
    status === 429 ||
    status === 503 ||
    /rate limit|rate_limit|too many requests|quota|capacity|tokens per|requests per|limit exceeded/i.test(
      msg
    )
  );
}

function requestOptions(envName) {
  if (process.env[envName] === 'false' || process.env.AI_TLS_REJECT_UNAUTHORIZED === 'false') {
    return { httpsAgent: new https.Agent({ rejectUnauthorized: false }) };
  }
  return {};
}

// ─── Appel Claude via axios ────────────────────────────
export async function callClaude(prompt, systemPrompt, maxTokens = 1000) {
  const key = process.env.ANTHROPIC_API_KEY?.trim();
  if (!key) throw new Error('ANTHROPIC_API_KEY manquant');

  const response = await axios.post(
    'https://api.anthropic.com/v1/messages',
    {
      model: process.env.ANTHROPIC_MODEL || 'claude-3-5-sonnet-latest',
      max_tokens: maxTokens,
      system: systemPrompt || 'Tu es un assistant M-ECAL en RDC.',
      messages: [{ role: 'user', content: prompt }],
    },
    {
      headers: {
        'x-api-key': key,
        'anthropic-version': '2023-06-01',
        'content-type': 'application/json',
      },
      timeout: 30000,
      ...requestOptions('ANTHROPIC_TLS_REJECT_UNAUTHORIZED'),
    }
  );
  return response.data.content[0].text;
}

// ─── Appel Groq via axios ──────────────────────────────
export async function callGroq(prompt, systemPrompt, maxTokens = 1000, modelOverride) {
  const key = process.env.GROQ_API_KEY?.trim();
  if (!key) throw new Error('GROQ_API_KEY manquant');

  const model = modelOverride || process.env.GROQ_MODEL || 'llama-3.3-70b-versatile';

  const response = await axios.post(
    'https://api.groq.com/openai/v1/chat/completions',
    {
      model,
      max_tokens: maxTokens,
      messages: [
        {
          role: 'system',
          content: systemPrompt || 'Tu es un assistant M-ECAL en RDC.',
        },
        { role: 'user', content: prompt },
      ],
    },
    {
      headers: {
        Authorization: `Bearer ${key}`,
        'content-type': 'application/json',
      },
      timeout: 30000,
      ...requestOptions('GROQ_TLS_REJECT_UNAUTHORIZED'),
    }
  );
  return response.data.choices[0].message.content;
}

async function callGroqProvider(prompt, systemPrompt, maxTokens) {
  try {
    return await callGroq(prompt, systemPrompt, maxTokens);
  } catch (err) {
    // Optional second Groq attempt (same provider slot). Default: cascade to Gemini instead.
    if (isRateLimitOrQuotaError(err) && process.env.GROQ_LITE_FALLBACK === 'true') {
      const lite = process.env.GROQ_LITE_MODEL || 'llama-3.1-8b-instant';
      logger.info(`Groq rate limit — essai modèle léger: ${lite}`);
      try {
        return await callGroq(prompt, systemPrompt, Math.min(maxTokens, 800), lite);
      } catch (liteErr) {
        logger.warn(`❌ Groq lite échoué: ${getErrorMessage(liteErr)} — passage au provider suivant`);
        throw liteErr;
      }
    }

    if (isRateLimitOrQuotaError(err)) {
      logger.warn(`❌ Groq limite/quota atteint — passage au provider suivant (Gemini)`);
    }

    throw err;
  }
}

// ─── Appel Gemini via axios ────────────────────────────
export async function callGemini(prompt, systemPrompt, maxTokens = 1000) {
  const key = process.env.GEMINI_API_KEY?.trim();
  if (!key) throw new Error('GEMINI_API_KEY manquant');

  const model = process.env.GEMINI_MODEL || 'gemini-2.0-flash';
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${key}`;

  const body = {
    contents: [{ parts: [{ text: prompt }] }],
    generationConfig: { maxOutputTokens: maxTokens },
  };

  if (systemPrompt) {
    body.systemInstruction = { parts: [{ text: systemPrompt }] };
  }

  const response = await axios.post(url, body, {
    headers: { 'content-type': 'application/json' },
    timeout: 30000,
    ...requestOptions('GEMINI_TLS_REJECT_UNAUTHORIZED'),
  });

  const text = response.data?.candidates?.[0]?.content?.parts?.[0]?.text;
  if (!text?.trim()) {
    const blockReason = response.data?.candidates?.[0]?.finishReason || 'empty_response';
    throw new Error(`Gemini réponse vide (${blockReason})`);
  }
  return text;
}

// ─── Liste ordonnée des providers (Claude → Groq → Gemini) ──
const PROVIDERS = [
  { name: 'claude', fn: callClaude },
  { name: 'groq', fn: callGroqProvider },
  { name: 'gemini', fn: callGemini },
];

function nextProviderName(currentName) {
  const idx = PROVIDERS.findIndex((p) => p.name === currentName);
  for (let i = idx + 1; i < PROVIDERS.length; i += 1) {
    if (isProviderConfigured(PROVIDERS[i].name)) return PROVIDERS[i].name;
  }
  return null;
}

// ─── Fallback cascade : essaie chacun dans l'ordre ────
export async function callAIWithFallback(
  prompt,
  systemPrompt = '',
  maxTokens = 1000
) {
  const errors = [];

  for (const provider of PROVIDERS) {
    if (!isProviderConfigured(provider.name)) {
      logger.info(`⏭️ ${provider.name} ignoré (clé API absente)`);
      continue;
    }

    try {
      logger.info(`Essai provider: ${provider.name}`);
      const text = await provider.fn(prompt, systemPrompt, maxTokens);
      logger.info(`✅ Réponse obtenue via ${provider.name}`);
      return { text, provider: provider.name };
    } catch (err) {
      const msg = getErrorMessage(err);
      const next = nextProviderName(provider.name);
      logger.warn(`❌ ${provider.name} échoué: ${msg}`);
      if (next) {
        logger.info(`↪️ Bascule vers ${next}`);
      }
      errors.push(`${provider.name}: ${msg}`);
    }
  }

  // Tous ont échoué
  throw new Error(
    `Tous les providers ont échoué:\n${errors.join('\n')}`
  );
}

// ─── JSON garanti ──────────────────────────────────────
export async function callAIForJSON(prompt, systemPrompt = '') {
  const jsonSystem = (systemPrompt || '') +
    '\n\nRéponds UNIQUEMENT avec du JSON valide. ' +
    'Pas de texte avant ou après. Pas de ```json```. ' +
    'Juste le JSON brut directement.';

  const errors = [];

  for (const provider of PROVIDERS) {
    if (!isProviderConfigured(provider.name)) {
      logger.info(`⏭️ ${provider.name} ignoré (clé API absente)`);
      continue;
    }

    try {
      logger.info(`AI JSON trying ${provider.name}`);
      const text = await provider.fn(prompt, jsonSystem, 1500);

      // Nettoyer la réponse
      let clean = text.trim();
      clean = clean.replace(/^```json\s*/i, '');
      clean = clean.replace(/^```\s*/i, '');
      clean = clean.replace(/\s*```$/i, '');
      clean = clean.trim();

      // Extraire le premier objet JSON
      const match = clean.match(/\{[\s\S]*\}/);
      if (!match) throw new Error('Aucun JSON trouvé dans la réponse');

      const parsed = JSON.parse(match[0]);
      logger.info(`✅ JSON valide obtenu via ${provider.name}`);
      return { data: parsed, provider: provider.name };
    } catch (err) {
      const msg = getErrorMessage(err);
      const next = nextProviderName(provider.name);
      logger.warn(`❌ ${provider.name} JSON échoué: ${msg}`);
      if (next) {
        logger.info(`↪️ Bascule vers ${next}`);
      }
      errors.push(`${provider.name}: ${msg}`);
    }
  }

  throw new Error(
    `Aucun provider n'a retourné un JSON valide:\n${errors.join('\n')}`
  );
}

// ─── Text simple ───────────────────────────────────────
export async function callAIText(prompt, systemPrompt = '', maxTokens = 1000) {
  const result = await callAIWithFallback(prompt, systemPrompt, maxTokens);
  return result.text;
}

// ─── Compatibilité ancien code ─────────────────────────
export async function callAIRace(prompt, systemPrompt = '', maxTokens = 1000) {
  return callAIWithFallback(prompt, systemPrompt, maxTokens);
}

// ─── Statut des providers ──────────────────────────────
export async function getProvidersStatus() {
  const status = {};

  for (const provider of PROVIDERS) {
    const keyMap = {
      claude: 'ANTHROPIC_API_KEY',
      groq: 'GROQ_API_KEY',
      gemini: 'GEMINI_API_KEY',
    };
    const key = process.env[keyMap[provider.name]]?.trim();
    status[provider.name] = {
      configured: !!key,
      ready: !!key,
      keyPrefix: key ? `${key.slice(0, 10)}...` : 'MANQUANT',
    };
  }

  return status;
}

// ─── Test direct de chaque provider ───────────────────
export async function testAllProviders() {
  const results = {};
  const testPrompt = 'Réponds juste "OK" en un mot.';

  for (const provider of PROVIDERS) {
    if (!isProviderConfigured(provider.name)) {
      results[provider.name] = { success: false, error: 'Clé API absente', skipped: true };
      continue;
    }
    try {
      const text = await provider.fn(testPrompt, '', 10);
      results[provider.name] = { success: true, response: text.slice(0, 30) };
    } catch (err) {
      const msg = getErrorMessage(err);
      results[provider.name] = { success: false, error: msg };
    }
  }

  return results;
}

// ─── Exports compatibilité avec l'ancien code ─────────
export const callClaudeJson = callAIForJSON;
export const callClaudeText = callAIText;
export const callClaudeJson2 = callAIForJSON;
export const callGroqDirect = callGroq;
export const callGeminiDirect = callGemini;

export default {
  callAIWithFallback,
  callAIForJSON,
  callAIText,
  callAIRace,
  callClaudeJson,
  callClaudeText,
  callClaudeJson2,
  callGroqDirect,
  callGeminiDirect,
  getProvidersStatus,
  testAllProviders,
};
