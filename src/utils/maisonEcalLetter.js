/** Mention professionnelle obligatoire en fin de chaque lettre IA. */
export const MAISON_ECAL_LETTER_MENTION =
  "Cette candidature est soumise avec l'appui de Maison ECAL, cabinet de conseil en logistique en République démocratique du Congo.";

const MENTION_RE = /appui de Maison ECAL|Maison ECAL,\s*cabinet de conseil/i;

export function hasMaisonEcalMention(text = '') {
  return MENTION_RE.test(String(text));
}

export function ensureMaisonEcalMention(text = '') {
  const src = String(text || '').trim();
  if (!src) return MAISON_ECAL_LETTER_MENTION;
  if (hasMaisonEcalMention(src)) return src;
  return `${src}\n\n${MAISON_ECAL_LETTER_MENTION}`;
}

export function splitMaisonEcalMention(text = '') {
  const ensured = ensureMaisonEcalMention(text);
  const body = ensured
    .split('\n')
    .filter((line) => !MENTION_RE.test(line))
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
  return { body, footer: MAISON_ECAL_LETTER_MENTION };
}
