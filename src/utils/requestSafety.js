/**
 * Petits utilitaires de sécurité pour les données reçues des requêtes.
 */

/** Échappe un texte saisi pour l'utiliser dans une RegExp (recherche « contient »). */
export function escapeRegex(input, maxLength = 80) {
  return String(input ?? '').slice(0, maxLength).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Copie un objet reçu en retirant les opérateurs MongoDB ($set, $unset…),
 * les chemins pointés (« a.b ») et les champs techniques interdits.
 */
export function stripUnsafeKeys(input, forbidden = []) {
  const out = {};
  if (!input || typeof input !== 'object' || Array.isArray(input)) return out;
  for (const [key, value] of Object.entries(input)) {
    if (key.startsWith('$') || key.includes('.') || forbidden.includes(key)) continue;
    out[key] = value;
  }
  return out;
}

/** Ne garde que les champs autorisés d'un objet reçu. */
export function pickKnown(input, allowed) {
  const out = {};
  if (!input || typeof input !== 'object') return out;
  for (const key of allowed) {
    if (Object.prototype.hasOwnProperty.call(input, key)) out[key] = input[key];
  }
  return out;
}
