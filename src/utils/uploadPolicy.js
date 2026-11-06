/**
 * Règles communes pour les fichiers déposés par les utilisateurs
 * (documents de candidature, CV) et pour les noms de fichiers renvoyés
 * au téléchargement.
 */
import path from 'path';

export const MAX_UPLOAD_BYTES = 8 * 1024 * 1024; // 8 Mo

/** Extensions acceptées → type MIME renvoyé au téléchargement. */
export const ALLOWED_TYPES = {
  '.pdf': 'application/pdf',
  '.doc': 'application/msword',
  '.docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  '.txt': 'text/plain; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp'
};

/** Signatures binaires : le contenu doit correspondre à l'extension annoncée. */
function matchesSignature(ext, buf) {
  const starts = (...bytes) => bytes.every((b, i) => buf[i] === b);
  switch (ext) {
    case '.pdf': return starts(0x25, 0x50, 0x44, 0x46); // %PDF
    case '.docx': return starts(0x50, 0x4b, 0x03, 0x04); // archive ZIP
    case '.doc': return starts(0xd0, 0xcf, 0x11, 0xe0); // ancien format Office
    case '.png': return starts(0x89, 0x50, 0x4e, 0x47);
    case '.jpg':
    case '.jpeg': return starts(0xff, 0xd8, 0xff);
    case '.webp': return starts(0x52, 0x49, 0x46, 0x46) && buf.slice(8, 12).toString('ascii') === 'WEBP';
    case '.txt': return !buf.slice(0, 4096).includes(0); // pas d'octet nul : du texte
    default: return false;
  }
}

export function extensionOf(fileName = '') {
  return path.extname(String(fileName)).toLowerCase();
}

/**
 * Vérifie un fichier reçu. Renvoie un message d'erreur (en français) ou null si tout va bien.
 * @param {{ fileName: string, buffer: Buffer, allowed?: string[], maxBytes?: number }} file
 */
export function validateUpload({ fileName, buffer, allowed = Object.keys(ALLOWED_TYPES), maxBytes = MAX_UPLOAD_BYTES }) {
  const ext = extensionOf(fileName);
  if (!allowed.includes(ext)) {
    return `Type de fichier non accepté. Formats autorisés : ${allowed.map((e) => e.slice(1).toUpperCase()).join(', ')}.`;
  }
  if (!buffer || buffer.length === 0) return 'Fichier vide.';
  if (buffer.length > maxBytes) {
    return `Fichier trop volumineux (maximum ${Math.round(maxBytes / (1024 * 1024))} Mo).`;
  }
  if (!matchesSignature(ext, buffer)) {
    return 'Le contenu du fichier ne correspond pas à son extension.';
  }
  return null;
}

/** Type MIME à renvoyer pour un nom de fichier stocké. */
export function contentTypeFor(fileName) {
  return ALLOWED_TYPES[extensionOf(fileName)] || 'application/octet-stream';
}

/**
 * En-tête Content-Disposition sûr : nom ASCII sans guillemets ni retours à la
 * ligne, plus la version UTF-8 (accents conservés) pour les navigateurs récents.
 */
export function contentDisposition(fileName, type = 'attachment') {
  const base = path.basename(String(fileName || 'document')).replace(/[\r\n"\\]/g, '');
  const ascii = base.normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^\x20-\x7e]/g, '_') || 'document';
  return `${type}; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(base)}`;
}
