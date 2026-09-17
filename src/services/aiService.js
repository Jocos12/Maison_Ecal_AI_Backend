import axios from 'axios';
import https from 'https';
import logger from '../utils/logger.js';
import { markAiDegraded, markAiSuccess } from './aiRuntimeHealth.js';

function getErrorMessage(err) {
  return err.response?.data?.error?.message || err.response?.data?.message || err.message;
}

function isProviderConfigured(name) {
  const keyMap = {
    claude: 'ANTHROPIC_API_KEY',
    gemini: 'GEMINI_API_KEY',
    groq: 'GROQ_API_KEY',
    openai: 'OPENAI_API_KEY'
  };
  return Boolean(process.env[keyMap[name]]?.trim());
}

function skippedProviderNames() {
  const fromList = String(process.env.AI_SKIP_PROVIDERS || '')
    .split(',')
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);
  if (['1', 'true', 'yes'].includes(String(process.env.AI_DISABLE_CLAUDE || '').toLowerCase())) {
    fromList.push('claude');
  }
  return new Set(fromList);
}

const aiUsage = {
  claude: 0,
  gemini: 0,
  groq: 0,
  openai: 0,
  keywords: 0
};

export function resetAiUsage() {
  aiUsage.claude = 0;
  aiUsage.gemini = 0;
  aiUsage.groq = 0;
  aiUsage.openai = 0;
  aiUsage.keywords = 0;
}

export function recordAiUsage(name) {
  const key = String(name || 'keywords');
  if (aiUsage[key] == null) aiUsage[key] = 0;
  aiUsage[key] += 1;
}

export function getAiUsage() {
  return { ...aiUsage };
}

export function primaryAiProvider(usage = getAiUsage()) {
  const order = ['claude', 'gemini', 'groq', 'openai', 'keywords'];
  let best = 'keywords';
  let n = -1;
  for (const name of order) {
    const count = Number(usage[name] || 0);
    if (count > n) {
      n = count;
      best = name;
    }
  }
  return n > 0 ? best : Object.values(usage).some((v) => v > 0) ? best : '';
}

/** Rate limit, quota, or capacity errors — should cascade to next provider. */
function isRateLimitOrQuotaError(err) {
  const status = err.response?.status;
  const msg = getErrorMessage(err);
  return (
    status === 429 ||
    status === 503 ||
    /rate limit|rate_limit|too many requests|quota|capacity|tokens per|requests per|limit exceeded|credit balance|too low|billing/i.test(
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
      timeout: 60000,
      ...requestOptions('ANTHROPIC_TLS_REJECT_UNAUTHORIZED'),
    }
  );
  return response.data.content[0].text;
}

const OBSOLETE_GROQ_MODELS = new Set([
  'llama-3.3-70b-versatile',
  'llama-3.1-70b-versatile',
  'llama-3.1-8b-instant',
  'llama-3.1-70b-specdec',
  'gemma2-9b-it',
  'gemma-7b-it',
  'mixtral-8x7b-32768'
]);

const GROQ_DEFAULT_MODEL = 'openai/gpt-oss-120b';
const GROQ_DEFAULT_LITE = 'openai/gpt-oss-20b';

// ─── Appel Groq via axios ──────────────────────────────
export async function callGroq(prompt, systemPrompt, maxTokens = 1000, modelOverride) {
  const key = process.env.GROQ_API_KEY?.trim();
  if (!key) throw new Error('GROQ_API_KEY manquant');

  const candidates = [
    modelOverride,
    process.env.GROQ_MODEL,
    GROQ_DEFAULT_MODEL,
    'qwen/qwen3.6-27b',
    GROQ_DEFAULT_LITE
  ].filter((m) => m && !OBSOLETE_GROQ_MODELS.has(String(m).trim()));
  const unique = [...new Set(candidates)];
  let lastErr;
  for (const model of unique) {
    try {
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
          timeout: /gpt-oss-20b|instant|8b/i.test(String(model)) ? 12000 : 30000,
          ...requestOptions('GROQ_TLS_REJECT_UNAUTHORIZED'),
        }
      );
      return response.data.choices[0].message.content;
    } catch (err) {
      lastErr = err;
      logger.warn(`Groq modèle ${model}: ${getErrorMessage(err)}`);
    }
  }
  throw lastErr || new Error('Groq: aucun modèle disponible');
}

async function callGroqFast(prompt, systemPrompt, maxTokens) {
  const lite = process.env.GROQ_LITE_MODEL || GROQ_DEFAULT_LITE;
  return callGroq(prompt, systemPrompt, Math.min(maxTokens, 500), lite);
}

async function callGroqProvider(prompt, systemPrompt, maxTokens) {
  try {
    return await callGroq(prompt, systemPrompt, maxTokens);
  } catch (err) {
    if (isRateLimitOrQuotaError(err)) {
      const lite = process.env.GROQ_LITE_MODEL || GROQ_DEFAULT_LITE;
      logger.info(`Groq rate limit — essai modèle léger: ${lite}`);
      try {
        return await callGroq(prompt, systemPrompt, Math.min(maxTokens, 800), lite);
      } catch (liteErr) {
        logger.warn(`❌ Groq lite échoué: ${getErrorMessage(liteErr)} — passage au provider suivant`);
        throw liteErr;
      }
    }
    throw err;
  }
}

// ─── Appel Gemini via axios ────────────────────────────
function extractGeminiVisibleText(data) {
  const cand = data?.candidates?.[0];
  const parts = cand?.content?.parts || [];
  const text = parts
    .map((p) => p?.text)
    .filter(Boolean)
    .join('\n')
    .trim();
  return { text, finishReason: cand?.finishReason || data?.promptFeedback?.blockReason || '' };
}

export async function callGemini(prompt, systemPrompt, maxTokens = 1000) {
  const key = process.env.GEMINI_API_KEY?.trim();
  if (!key) throw new Error('GEMINI_API_KEY manquant');

  const obsoleteGemini = new Set(['gemini-2.0-flash', 'gemini-1.5-flash', 'gemini-pro']);
  const models = [
    process.env.GEMINI_MODEL,
    'gemini-3.6-flash',
    'gemini-2.5-flash',
    'gemini-flash-latest'
  ].filter((m) => m && !obsoleteGemini.has(String(m).trim()));
  const unique = [...new Set(models)];
  let lastErr;
  for (const model of unique) {
    try {
      const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${key}`;
      const generationConfig = {
        maxOutputTokens: Math.max(Number(maxTokens) || 1000, 1024)
      };
      // Les Flash 2.5+ consomment le budget de sortie en "thinking" — sinon la réponse visible
      // s'arrête souvent au milieu d'une liste (ex. « 1. 🎓 »).
      if (/2\.5|3\./.test(String(model))) {
        generationConfig.thinkingConfig = { thinkingBudget: 0 };
      }
      const body = {
        contents: [{ parts: [{ text: prompt }] }],
        generationConfig
      };
      if (systemPrompt) {
        body.systemInstruction = { parts: [{ text: systemPrompt }] };
      }
      const postOpts = {
        headers: { 'content-type': 'application/json' },
        timeout: 90000,
        ...requestOptions('GEMINI_TLS_REJECT_UNAUTHORIZED')
      };
      let response;
      const postOnce = (payload) => axios.post(url, payload, postOpts);
      try {
        response = await postOnce(body);
      } catch (err) {
        const certError =
          err.code === 'UNABLE_TO_VERIFY_LEAF_SIGNATURE' ||
          err.code === 'CERT_HAS_EXPIRED' ||
          /certificate/i.test(getErrorMessage(err));
        if (certError) {
          logger.warn(`Gemini TLS — nouvel essai sans vérification stricte (${model})`);
          response = await axios.post(url, body, {
            ...postOpts,
            httpsAgent: new https.Agent({ rejectUnauthorized: false })
          });
        } else if (generationConfig.thinkingConfig && /thinking|unknown|invalid/i.test(getErrorMessage(err))) {
          delete generationConfig.thinkingConfig;
          response = await postOnce(body);
        } else {
          throw err;
        }
      }
      const { text, finishReason } = extractGeminiVisibleText(response.data);
      if (!text) {
        throw new Error(`Gemini réponse vide (${finishReason || 'empty_response'})`);
      }
      if (String(finishReason).toUpperCase() === 'MAX_TOKENS' && text.length < 160) {
        logger.warn(`Gemini tronqué (${model}, ${text.length} car.) — bascule provider`);
        throw new Error(`Gemini tronqué (${finishReason})`);
      }
      return text;
    } catch (err) {
      lastErr = err;
      logger.warn(`Gemini modèle ${model}: ${getErrorMessage(err)}`);
    }
  }
  throw lastErr || new Error('Gemini: aucun modèle disponible');
}

export async function callOpenAI(prompt, systemPrompt, maxTokens = 1000) {
  const key = process.env.OPENAI_API_KEY?.trim();
  if (!key) throw new Error('OPENAI_API_KEY manquant');
  const model = process.env.OPENAI_MODEL || 'gpt-4o-mini';
  try {
    const response = await axios.post(
      'https://api.openai.com/v1/chat/completions',
      {
        model,
        max_tokens: maxTokens,
        messages: [
          { role: 'system', content: systemPrompt || 'Tu es un assistant M-ECAL en RDC.' },
          { role: 'user', content: prompt }
        ]
      },
      {
        headers: {
          Authorization: `Bearer ${key}`,
          'content-type': 'application/json'
        },
        timeout: 90000,
        ...requestOptions('OPENAI_TLS_REJECT_UNAUTHORIZED')
      }
    );
    const text = response.data?.choices?.[0]?.message?.content;
    if (!text?.trim()) throw new Error('OpenAI réponse vide');
    return text;
  } catch (err) {
    const certError =
      err.code === 'UNABLE_TO_VERIFY_LEAF_SIGNATURE' || /certificate/i.test(err.message || '');
    if (!certError) throw err;
    const response = await axios.post(
      'https://api.openai.com/v1/chat/completions',
      {
        model,
        max_tokens: maxTokens,
        messages: [
          { role: 'system', content: systemPrompt || 'Tu es un assistant M-ECAL en RDC.' },
          { role: 'user', content: prompt }
        ]
      },
      {
        headers: {
          Authorization: `Bearer ${key}`,
          'content-type': 'application/json'
        },
        timeout: 90000,
        httpsAgent: new https.Agent({ rejectUnauthorized: false })
      }
    );
    const text = response.data?.choices?.[0]?.message?.content;
    if (!text?.trim()) throw new Error('OpenAI réponse vide');
    return text;
  }
}

// ─── Liste ordonnée : Claude → Gemini → Groq → OpenAI ──
const PROVIDERS_FULL = [
  { name: 'claude', fn: callClaude },
  { name: 'gemini', fn: callGemini },
  { name: 'groq', fn: callGroqProvider },
  { name: 'openai', fn: callOpenAI }
];

function nextProviderName(list, currentName) {
  const idx = list.findIndex((p) => p.name === currentName);
  const skipped = skippedProviderNames();
  for (let i = idx + 1; i < list.length; i += 1) {
    if (skipped.has(list[i].name)) continue;
    if (isProviderConfigured(list[i].name)) return list[i].name;
  }
  return null;
}

export function isComplexAiTask(text = '') {
  return /lettre|motivation|cv\b|curriculum|proposition|r[ée]dig|analys(e|er)|compar(e|er)|strat[ée]g|d[ée]taill|synth[eè]se|expliquer|tendance|pourquoi|pertinen|semaine|cover letter/i.test(
    String(text)
  );
}

export async function callAIWithFallback(
  prompt,
  systemPrompt = '',
  maxTokens = 1000,
  options = {}
) {
  const mode = options.mode === 'fast' ? 'fast' : 'full';
  const list = PROVIDERS_FULL;
  const errors = [];
  // Même prompt + même budget de tokens pour Claude et tous les fallbacks (Gemini, Groq, OpenAI).
  const tokens = maxTokens;

  for (const provider of list) {
    if (skippedProviderNames().has(provider.name)) {
      logger.info(`⏭️ ${provider.name} ignoré (AI_SKIP_PROVIDERS / AI_DISABLE_CLAUDE)`);
      continue;
    }
    if (!isProviderConfigured(provider.name)) {
      logger.info(`⏭️ ${provider.name} ignoré (clé API absente)`);
      continue;
    }

    try {
      logger.info(
        `Essai provider: ${provider.name} (mode=${mode}, prompt=${String(prompt || '').length} car., maxTokens=${tokens})`
      );
      const text = await provider.fn(prompt, systemPrompt, tokens);
      recordAiUsage(provider.name);
      logger.info(`✅ Réponse obtenue via ${provider.name}`);
      if (!options.probe) markAiSuccess(provider.name);
      return { text, provider: provider.name, mode };
    } catch (err) {
      const msg = getErrorMessage(err);
      const next = nextProviderName(list, provider.name);
      logger.warn(`❌ ${provider.name} échoué: ${msg}`);
      if (next) logger.info(`↪️ Bascule vers ${next}`);
      errors.push(`${provider.name}: ${msg}`);
    }
  }

  if (!options.probe) markAiDegraded();
  throw new Error(`Tous les providers ont échoué:\n${errors.join('\n')}`);
}

// ─── JSON garanti ──────────────────────────────────────
export async function callAIForJSON(prompt, systemPrompt = '') {
  const jsonSystem = (systemPrompt || '') +
    '\n\nRéponds UNIQUEMENT avec du JSON valide. ' +
    'Pas de texte avant ou après. Pas de ```json```. ' +
    'Juste le JSON brut directement.';

  const errors = [];

  for (const provider of PROVIDERS_FULL) {
    if (skippedProviderNames().has(provider.name)) {
      logger.info(`⏭️ ${provider.name} ignoré (AI_SKIP_PROVIDERS / AI_DISABLE_CLAUDE)`);
      continue;
    }
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
      recordAiUsage(provider.name);
      logger.info(`✅ JSON valide obtenu via ${provider.name}`);
      markAiSuccess(provider.name);
      return { data: parsed, provider: provider.name };
    } catch (err) {
      const msg = getErrorMessage(err);
      const next = nextProviderName(PROVIDERS_FULL, provider.name);
      logger.warn(`❌ ${provider.name} JSON échoué: ${msg}`);
      if (next) {
        logger.info(`↪️ Bascule vers ${next}`);
      }
      errors.push(`${provider.name}: ${msg}`);
    }
  }

  markAiDegraded();
  throw new Error(
    `Aucun provider n'a retourné un JSON valide:\n${errors.join('\n')}`
  );
}

// ─── Text simple ───────────────────────────────────────
export async function callAIText(prompt, systemPrompt = '', maxTokens = 1000, options = {}) {
  const result = await callAIWithFallback(prompt, systemPrompt, maxTokens, options);
  return result.text;
}

// ─── Compatibilité ancien code ─────────────────────────
export async function callAIRace(prompt, systemPrompt = '', maxTokens = 1000) {
  return callAIWithFallback(prompt, systemPrompt, maxTokens);
}

// ─── Statut des providers ──────────────────────────────
export async function getProvidersStatus() {
  const status = {};

  for (const provider of PROVIDERS_FULL) {
    const keyMap = {
      claude: 'ANTHROPIC_API_KEY',
      gemini: 'GEMINI_API_KEY',
      groq: 'GROQ_API_KEY',
      openai: 'OPENAI_API_KEY'
    };
    const key = process.env[keyMap[provider.name]]?.trim();
    status[provider.name] = {
      configured: !!key,
      ready: !!key && !skippedProviderNames().has(provider.name),
      skipped: skippedProviderNames().has(provider.name)
    };
  }

  return status;
}

// ─── Test direct de chaque provider ───────────────────
export async function testAllProviders() {
  const results = {};
  const testPrompt = 'Réponds juste "OK" en un mot.';

  for (const provider of PROVIDERS_FULL) {
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
  callOpenAI,
  getProvidersStatus,
  testAllProviders,
  resetAiUsage,
  getAiUsage,
  recordAiUsage
};
