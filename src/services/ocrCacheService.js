import OcrCache from '../models/OcrCache.js';
import logger from '../utils/logger.js';

const EMPTY_RETRY_MS = 7 * 24 * 60 * 60 * 1000;

export function normalizeOcrUrl(url) {
  try {
    const u = new URL(String(url || '').trim());
    u.hash = '';
    return u.href;
  } catch {
    return String(url || '').trim();
  }
}

export async function getCachedOcr(url) {
  const key = normalizeOcrUrl(url);
  if (!key) return null;
  const doc = await OcrCache.findOne({ url: key }).lean();
  if (!doc) return null;
  const empty = !String(doc.ocrText || '').trim() && !doc.deadline;
  if (empty && doc.updatedAt && Date.now() - new Date(doc.updatedAt).getTime() > EMPTY_RETRY_MS) {
    return null;
  }
  return doc;
}

export async function saveCachedOcr(url, payload = {}) {
  const key = normalizeOcrUrl(url);
  if (!key) return null;
  try {
    return await OcrCache.findOneAndUpdate(
      { url: key },
      {
        $set: {
          ocrText: String(payload.ocrText || '').slice(0, 20000),
          provider: String(payload.provider || ''),
          deadline: payload.deadline || null,
          matchedPhrase: String(payload.matchedPhrase || '').slice(0, 200),
          error: String(payload.error || '').slice(0, 500)
        }
      },
      { upsert: true, new: true }
    );
  } catch (e) {
    logger.warn(`OcrCache save ${key}: ${e.message}`);
    return null;
  }
}
