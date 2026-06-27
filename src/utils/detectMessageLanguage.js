const ENGLISH_MARKERS =
  /\b(the|you|your|are|is|was|were|what|which|where|when|how|why|can|could|would|should|please|hello|hi|thanks|thank|sure|even|job|jobs|offer|offers|logistics|warehouse|driver|search|find|show|list|many|count|apply|help|want|need|about|with|from|this|that|these|those|any|some|all|my|me|we|they|them|their|have|has|had|do|does|did|will|not|don't|doesn't|isn't|aren't)\b/i;

const FRENCH_MARKERS =
  /\b(je|tu|vous|nous|ils|elles|le|la|les|un|une|des|du|de|et|est|sont|été|quoi|quel|quelle|quels|quelles|comment|combien|où|pourquoi|quand|bonjour|merci|offre|offres|emploi|emplois|logistique|cherche|recherch|poste|postuler|aide|avec|dans|pour|sur|mon|ma|mes|ton|ta|tes|votre|vos|notre|nos|être|avoir|faire|peux|pouvez|veux|voulez|suis|es|êtes|sommes)\b/i;

const SWAHILI_MARKERS =
  /\b(habari|asante|ndiyo|hapana|kazi|nafasi|msaada|tafadhali|karibu|sawa|jambo|pole|nzuri|wapi|nini|kwa|na|ya|ni|mimi|wewe|sisi|wao)\b/i;

export function detectMessageLanguage(message = '', history = []) {
  const samples = [
    String(message || '').trim(),
    ...history
      .filter((m) => m.role === 'user')
      .slice(-3)
      .map((m) => String(m.content || '').trim())
  ].filter(Boolean);

  let englishScore = 0;
  let frenchScore = 0;
  let swahiliScore = 0;

  for (const text of samples) {
    englishScore += (text.match(ENGLISH_MARKERS) || []).length;
    frenchScore += (text.match(FRENCH_MARKERS) || []).length;
    swahiliScore += (text.match(SWAHILI_MARKERS) || []).length;
    if (/[àâäéèêëïîôùûüçœæ]/i.test(text)) frenchScore += 2;
    if (/\b(i'm|i am|you're|don't|can't|won't|it's|that's)\b/i.test(text)) englishScore += 2;
  }

  if (swahiliScore > frenchScore && swahiliScore > englishScore && swahiliScore >= 1) return 'sw';
  if (englishScore > frenchScore && englishScore >= 1) return 'en';
  if (frenchScore > englishScore) return 'fr';
  if (englishScore > 0 && frenchScore === 0) return 'en';
  return 'fr';
}

export function languageLabel(locale = 'fr') {
  if (locale === 'en') return 'English';
  if (locale === 'sw') return 'Kiswahili';
  return 'Français';
}
