import axios from 'axios';
import https from 'https';
import logger from '../utils/logger.js';

const OPENAI_TTS_URL = 'https://api.openai.com/v1/audio/speech';
const ALLOWED_VOICES = new Set(['nova', 'shimmer', 'onyx', 'alloy', 'echo', 'fable']);
const ALLOWED_MODELS = new Set(['tts-1', 'tts-1-hd']);
/** Soft cap to control cost (OpenAI hard limit is 4096). */
const MAX_TTS_CHARS = Number(process.env.OPENAI_TTS_MAX_CHARS || 800);

function tlsAgent() {
  if (process.env.OPENAI_TLS_REJECT_UNAUTHORIZED === 'false') {
    return new https.Agent({ rejectUnauthorized: false });
  }
  return undefined;
}

export function getTtsConfig() {
  return {
    configured: Boolean((process.env.OPENAI_API_KEY || '').trim()),
    defaultVoice: process.env.OPENAI_TTS_VOICE || 'nova',
    defaultModel: process.env.OPENAI_TTS_MODEL || 'tts-1',
    maxChars: MAX_TTS_CHARS,
    voices: ['nova', 'shimmer', 'onyx'],
    models: ['tts-1', 'tts-1-hd']
  };
}

/**
 * Strip markdown / noise so spoken audio stays natural.
 */
export function prepareTextForSpeech(raw = '', maxChars = MAX_TTS_CHARS) {
  let text = String(raw || '')
    .replace(/```[\s\S]*?```/g, ' ')
    .replace(/`([^`]+)`/g, '$1')
    .replace(/!\[[^\]]*]\([^)]*\)/g, ' ')
    .replace(/\[([^\]]+)]\([^)]*\)/g, '$1')
    .replace(/[#>*_~|]+/g, ' ')
    .replace(/📥|🤖|🔍|📄|✉️|📬|📊|💬|✅|❌|ℹ️|🏆|👤|📤/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

  if (text.length > maxChars) {
    text = `${text.slice(0, maxChars).trim()}…`;
  }
  return text;
}

export async function synthesizeSpeech({ text, voice, model }) {
  const apiKey = (process.env.OPENAI_API_KEY || '').trim();
  if (!apiKey) {
    const err = new Error('OPENAI_API_KEY manquante — configurez-la dans backend/.env');
    err.status = 503;
    err.code = 'tts_not_configured';
    throw err;
  }

  const input = prepareTextForSpeech(text);
  if (!input) {
    const err = new Error('Texte vide pour la synthèse vocale');
    err.status = 400;
    throw err;
  }

  const chosenVoice = ALLOWED_VOICES.has(voice) ? voice : getTtsConfig().defaultVoice;
  const chosenModel = ALLOWED_MODELS.has(model) ? model : getTtsConfig().defaultModel;

  try {
    const res = await axios.post(
      OPENAI_TTS_URL,
      {
        model: chosenModel,
        input,
        voice: chosenVoice,
        response_format: 'mp3'
      },
      {
        headers: {
          Authorization: `Bearer ${apiKey}`,
          'Content-Type': 'application/json'
        },
        responseType: 'arraybuffer',
        timeout: 60000,
        httpsAgent: tlsAgent(),
        validateStatus: () => true
      }
    );

    if (res.status >= 400) {
      let detail = `OpenAI TTS HTTP ${res.status}`;
      try {
        const parsed = JSON.parse(Buffer.from(res.data).toString('utf8'));
        detail = parsed?.error?.message || detail;
      } catch {
        /* ignore */
      }
      logger.warn('OpenAI TTS failed', { status: res.status, detail: String(detail).slice(0, 200) });
      const err = new Error(detail);
      err.status = res.status === 401 || res.status === 403 ? 502 : res.status;
      throw err;
    }

    return {
      buffer: Buffer.from(res.data),
      contentType: 'audio/mpeg',
      voice: chosenVoice,
      model: chosenModel,
      chars: input.length
    };
  } catch (e) {
    if (e.status) throw e;
    logger.error(`OpenAI TTS network error: ${e.message}`);
    const err = new Error('Impossible de générer l’audio pour le moment');
    err.status = 502;
    throw err;
  }
}
