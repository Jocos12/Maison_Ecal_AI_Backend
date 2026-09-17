/**
 * Extraction de dates de clôture depuis PDF (texte) et scans d'avis ARMP.
 */
import * as cheerio from 'cheerio';
import axios from 'axios';
import https from 'https';
import logger from '../utils/logger.js';
import { extractDatesFromText, parseLooseDate } from './dateExtract.js';
import { ocrImageBuffer } from './tesseractOcr.js';
import { mapLimit } from './concurrency.js';
import { getCachedOcr, saveCachedOcr } from '../services/ocrCacheService.js';
import { ocrJobStart, ocrJobEnd } from '../utils/scanTiming.js';

async function fetchBuffer(url) {
  const extra = {
    timeout: 45000,
    responseType: 'arraybuffer',
    headers: {
      'User-Agent': process.env.USER_AGENT || 'M-ECAL-Bot/1.0',
      Accept: 'application/pdf,image/*,*/*'
    },
    maxRedirects: 5
  };
  try {
    const { data, headers } = await axios.get(url, extra);
    return { buffer: Buffer.from(data), contentType: headers['content-type'] || '' };
  } catch (err) {
    const certError =
      err.code === 'UNABLE_TO_VERIFY_LEAF_SIGNATURE' ||
      err.code === 'CERT_HAS_EXPIRED' ||
      /certificate/i.test(err.message || '');
    if (!certError) throw err;
    const { data, headers } = await axios.get(url, {
      ...extra,
      httpsAgent: new https.Agent({ rejectUnauthorized: false })
    });
    return { buffer: Buffer.from(data), contentType: headers['content-type'] || '' };
  }
}

/** Formulations recherchées (FR/EN) — à enrichir si de nouveaux libellés apparaissent. */
export const PDF_DEADLINE_PHRASES = [
  'au plus tard le',
  'au plus tard',
  'date limite de dépôt',
  'date limite de depot',
  'date limite de soumission',
  'date limite de remise',
  'date limite de réception',
  'date limite de reception',
  'date de clôture',
  'date de cloture',
  'clôture le',
  'cloture le',
  'avant le',
  "jusqu'au",
  'jusqu’au',
  'dépôt des offres',
  'depot des offres',
  'remise des offres',
  'réception des offres',
  'les plis seront reçus',
  'les plis doivent',
  'heure limite',
  'closing date',
  'submission deadline',
  'deadline'
];

const PHRASE_RE = new RegExp(
  `(${PDF_DEADLINE_PHRASES.map((p) => p.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|')})`,
  'i'
);

function magicIsPdf(buffer) {
  return buffer?.length >= 5 && buffer.slice(0, 5).toString('latin1') === '%PDF-';
}

function magicIsImage(buffer) {
  if (!buffer?.length) return false;
  const hex = buffer.slice(0, 3).toString('hex');
  return hex === 'ffd8ff' || hex === '89504e' || buffer.slice(0, 4).toString('latin1') === 'RIFF';
}

export function extractDeadlineFromPdfText(raw = '') {
  const text = String(raw || '').replace(/\s+/g, ' ').trim();
  if (!text) return { deadline: null, matchedPhrase: null, sourceText: '' };

  const phraseHit = text.match(PHRASE_RE);
  if (phraseHit) {
    const idx = phraseHit.index || 0;
    const window = text.slice(idx, idx + 140);
    const deadline = parseLooseDate(window) || extractDatesFromText(window).deadline;
    if (deadline) {
      return { deadline, matchedPhrase: phraseHit[1], sourceText: window };
    }
  }

  return { deadline: null, matchedPhrase: null, sourceText: text.slice(0, 200) };
}

export function isPlausibleClosingDate(date, postedDate) {
  if (!(date instanceof Date) || Number.isNaN(date.getTime())) {
    return { ok: false, reason: 'invalid' };
  }
  const y = date.getUTCFullYear();
  if (y < 2025 || y > 2027) return { ok: false, reason: `year_${y}` };
  const deltaDays = (date.getTime() - Date.now()) / 86400000;
  if (deltaDays > 400) return { ok: false, reason: 'too_far_future' };
  if (deltaDays < -400) return { ok: false, reason: 'too_old' };
  if (postedDate instanceof Date && !Number.isNaN(postedDate.getTime())) {
    const postedY = postedDate.getUTCFullYear();
    if (y < postedY) return { ok: false, reason: 'before_publication' };
    const daysBeforePost = (postedDate.getTime() - date.getTime()) / 86400000;
    if (daysBeforePost > 120) return { ok: false, reason: 'before_publication' };
  }
  return { ok: true };
}

export function decideDeadlineApplication(found, postedDate) {
  if (!found?.deadline) return { apply: false, review: false, reason: 'none' };
  const plausible = isPlausibleClosingDate(found.deadline, postedDate);
  const phraseOk =
    found.matchedPhrase !== 'hint-générique' &&
    (PHRASE_RE.test(String(found.matchedPhrase || '')) || PHRASE_RE.test(String(found.sourceText || '')));
  if (!plausible.ok) {
    return { apply: false, review: true, reason: plausible.reason };
  }
  if (!phraseOk) {
    return { apply: false, review: true, reason: 'no_closing_phrase' };
  }
  return { apply: true, review: false, reason: 'ok' };
}

async function ocrDeadlineFromImage(buffer, contentType, postedDate, { cachedText } = {}) {
  const ext = /png/i.test(contentType) ? 'png' : 'jpg';
  let tessText = String(cachedText || '');
  let providerHint = tessText ? 'cache' : '';
  if (!tessText) {
    try {
      const tess = await ocrImageBuffer(buffer, { ext });
      tessText = tess.text || '';
      providerHint = tess.provider || 'tesseract';
    } catch (e) {
      logger.warn(`Tesseract: ${e.message}`);
    }
  }

  const fromTess = extractDeadlineFromPdfText(tessText);
  const tessDecision = decideDeadlineApplication(fromTess, postedDate);
  if (tessDecision.apply) {
    return { ...fromTess, provider: providerHint || 'tesseract', decision: tessDecision, tessText };
  }

  const tessWeak = tessText.length < 60;
  if (tessWeak && buffer) {
    const gemini = await extractDeadlineViaGeminiVision(
      buffer,
      ext === 'png' ? 'image/png' : 'image/jpeg'
    );
    if (gemini?.deadline) {
      const phrase =
        gemini.matchedPhrase && PHRASE_RE.test(gemini.matchedPhrase)
          ? gemini.matchedPhrase
          : fromTess.matchedPhrase || gemini.matchedPhrase;
      const merged = { deadline: gemini.deadline, matchedPhrase: phrase };
      const decision = decideDeadlineApplication(merged, postedDate);
      return {
        ...merged,
        provider: 'gemini',
        decision,
        tessPreview: tessText.slice(0, 180),
        tessText
      };
    }
  }

  return {
    deadline: fromTess.deadline,
    matchedPhrase: fromTess.matchedPhrase,
    provider: tessText ? providerHint || 'tesseract' : null,
    decision: tessDecision.review
      ? tessDecision
      : { apply: false, review: Boolean(tessText), reason: tessDecision.reason || 'empty' },
    tessPreview: tessText.slice(0, 180),
    tessText
  };
}

function applyOcrHit(result, att, ocr) {
  if (ocr.decision?.apply && ocr.deadline) {
    result.deadline = ocr.deadline;
    result.source = att.url;
    result.matchedPhrase = ocr.matchedPhrase;
    result.provider = ocr.provider;
    result.review = null;
    logger.info(
      `Deadline OCR (${ocr.provider} / ${ocr.matchedPhrase}) ${ocr.deadline.toISOString().slice(0, 10)} ← ${att.url}`
    );
    return true;
  }
  if (ocr.decision?.review && ocr.deadline && !result.review) {
    result.review = {
      url: att.url,
      deadline: ocr.deadline,
      reason: ocr.decision.reason,
      phrase: ocr.matchedPhrase,
      preview: ocr.tessPreview
    };
    logger.warn(
      `Date OCR à vérifier manuellement (${ocr.decision.reason}) ${ocr.deadline?.toISOString?.().slice(0, 10) || 'n/a'} ← ${att.url}`
    );
  }
  return false;
}

async function processImageAttachment(att, postedDate) {
  const cached = await getCachedOcr(att.url);
  if (cached?.ocrText || cached?.deadline) {
    const ocrStarted = ocrJobStart(att.url, { cacheHit: true });
    try {
      logger.info(`OCR cache hit ← ${att.url}`);
      const ocr = await ocrDeadlineFromImage(null, '', postedDate, { cachedText: cached.ocrText });
      if (!ocr.deadline && cached.deadline) {
        ocr.deadline = cached.deadline;
        ocr.matchedPhrase = cached.matchedPhrase || ocr.matchedPhrase;
        ocr.decision = decideDeadlineApplication(ocr, postedDate);
      }
      ocr.provider = ocr.provider || cached.provider || 'cache';
      return ocr;
    } finally {
      ocrJobEnd(att.url, ocrStarted, { cacheHit: true });
    }
  }

  const ocrStarted = ocrJobStart(att.url, { cacheHit: false });
  try {
    const { buffer, contentType } = await fetchBuffer(att.url);
    const ocr = await ocrDeadlineFromImage(buffer, contentType, postedDate);
    await saveCachedOcr(att.url, {
      ocrText: ocr.tessText,
      provider: ocr.provider,
      deadline: ocr.deadline,
      matchedPhrase: ocr.matchedPhrase
    });
    return ocr;
  } finally {
    ocrJobEnd(att.url, ocrStarted, { cacheHit: false });
  }
}

export function collectArmpAttachmentUrls(html, pageUrl) {
  const $ = cheerio.load(String(html || ''));
  const urls = [];
  const seen = new Set();
  const push = (href, kind) => {
    if (!href) return;
    let abs;
    try {
      abs = new URL(href, pageUrl).href;
    } catch {
      return;
    }
    if (seen.has(abs)) return;
    seen.add(abs);
    urls.push({ url: abs, kind });
  };

  $('a[href]').each((_, el) => {
    const href = $(el).attr('href') || '';
    if (/\.pdf(\?|#|$)/i.test(href) || /application\/pdf/i.test($(el).attr('type') || '')) {
      push(href, 'pdf');
    }
  });

  $('.job_description img[src], .entry-content img[src], article img[src]').each((_, el) => {
    const src = $(el).attr('src') || $(el).attr('data-src') || '';
    if (!/\.(jpe?g|png|webp)(\?|#|$)/i.test(src)) return;
    if (/logo|icon|avatar|burst|emoji|spinner/i.test(src)) return;
    const w = Number($(el).attr('width') || 0);
    if (w && w < 400) return;
    push(src.split(' ')[0], 'image');
  });

  return urls;
}

async function parsePdfBuffer(buffer) {
  const mod = await import('pdf-parse');
  const pdfParse = mod.default || mod;
  return pdfParse(buffer);
}

async function extractDeadlineViaGeminiVision(buffer, mimeType = 'image/jpeg') {
  const key = process.env.GEMINI_API_KEY?.trim();
  if (!key) return null;
  const models = [
    'gemini-3.6-flash',
    'gemini-2.5-flash',
    'gemini-flash-latest'
  ].filter(Boolean);
  const prompt =
    'Lis cet avis d’appel d’offres / AMI (image scannée). ' +
    'Extrais UNIQUEMENT la date limite de dépôt des offres (clôture). ' +
    'JSON strict: {"deadline":"YYYY-MM-DD ou null","phrase":"extrait court ou null"}. ' +
    'Pas d’autre texte.';
  const b64 = buffer.toString('base64');
  for (const model of [...new Set(models)]) {
    try {
      const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${key}`;
      const { data } = await axios.post(
        url,
        {
          contents: [
            {
              parts: [
                { text: prompt },
                { inlineData: { mimeType, data: b64 } }
              ]
            }
          ],
          generationConfig: { maxOutputTokens: 200 }
        },
        {
          timeout: 45000,
          headers: { 'content-type': 'application/json' },
          httpsAgent: new https.Agent({ rejectUnauthorized: false })
        }
      );
      const text = data?.candidates?.[0]?.content?.parts?.[0]?.text || '';
      const match = text.match(/\{[\s\S]*\}/);
      if (!match) continue;
      const parsed = JSON.parse(match[0]);
      const deadline = parseLooseDate(parsed.deadline);
      if (deadline) return { deadline, matchedPhrase: parsed.phrase || 'ocr-gemini' };
    } catch (e) {
      logger.warn(`OCR Gemini ${model}: ${e.message}`);
    }
  }
  return null;
}

/**
 * @returns {{ deadline: Date|null, source: string|null, matchedPhrase: string|null, ocrNeeded: boolean, pdfCount: number, imageCount: number }}
 */
export async function extractDeadlineFromArmpAttachments(html, pageUrl, { maxImages = 4, postedDate } = {}) {
  const attachments = collectArmpAttachmentUrls(html, pageUrl);
  const result = {
    deadline: null,
    source: null,
    matchedPhrase: null,
    ocrNeeded: false,
    pdfCount: attachments.filter((a) => a.kind === 'pdf').length,
    imageCount: attachments.filter((a) => a.kind === 'image').length
  };

  const pdfs = attachments.filter((a) => a.kind === 'pdf');
  const images = attachments.filter((a) => a.kind === 'image').slice(0, maxImages);
  const ocrConcurrency = Math.max(1, Math.min(5, Number(process.env.OCR_CONCURRENCY || 4)));
  logger.info(
    `TIMING OCR_CONCURRENCY=${ocrConcurrency} images=${images.length} pdfs=${pdfs.length} page=${pageUrl}`
  );

  await mapLimit(pdfs, 3, async (att) => {
    if (result.deadline) return;
    try {
      const { buffer, contentType } = await fetchBuffer(att.url);
      if (!(magicIsPdf(buffer) || /pdf/i.test(contentType))) return;
      const parsed = await parsePdfBuffer(buffer);
      const text = String(parsed.text || '').trim();
      if (text.length < 40) {
        result.ocrNeeded = true;
        logger.warn(`PDF nécessite OCR: ${att.url} (texte=${text.length} car.)`);
        return;
      }
      const found = extractDeadlineFromPdfText(text);
      const decision = decideDeadlineApplication(found, postedDate);
      if (decision.apply && found.deadline && !result.deadline) {
        result.deadline = found.deadline;
        result.source = att.url;
        result.matchedPhrase = found.matchedPhrase;
        result.provider = 'pdf-text';
        logger.info(
          `Deadline PDF extraite (${found.matchedPhrase}) ${found.deadline.toISOString().slice(0, 10)} ← ${att.url}`
        );
      } else if (decision.review && !result.review) {
        result.review = {
          url: att.url,
          deadline: found.deadline,
          reason: decision.reason,
          phrase: found.matchedPhrase
        };
        logger.warn(
          `Date PDF à vérifier manuellement (${decision.reason}) ${found.deadline?.toISOString?.().slice(0, 10)} ← ${att.url}`
        );
      }
    } catch (e) {
      logger.warn(`Pièce ARMP illisible ${att.url}: ${e.message}`);
    }
  });

  if (result.deadline || !images.length) return result;

  result.ocrNeeded = true;
  await mapLimit(images, ocrConcurrency, async (att) => {
    if (result.deadline) return;
    try {
      logger.warn(`Pièce jointe image (OCR): ${att.url}`);
      const ocr = await processImageAttachment(att, postedDate);
      applyOcrHit(result, att, ocr);
    } catch (e) {
      logger.warn(`Pièce ARMP illisible ${att.url}: ${e.message}`);
      await saveCachedOcr(att.url, { error: e.message }).catch(() => {});
    }
  });

  return result;
}
