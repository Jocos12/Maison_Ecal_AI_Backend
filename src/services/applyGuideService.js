import Opportunity from '../models/Opportunity.js';
import Application from '../models/Application.js';
import SystemSetting from '../models/SystemSetting.js';
import { extractContactEmails } from '../utils/extractContactEmail.js';
import { fetchHtml, loadCheerio, absoluteUrl } from '../scrapers/utils.js';
import { callAIText } from './aiService.js';
import { stripMarkdown } from '../utils/stripMarkdown.js';
import logger from '../utils/logger.js';

const PORTAL_HINT =
  /apply|postul|candidat|career|emploi|job|vacanc|ungm|unjobs|devex|workday|taleo|greenhouse|lever\.co|oraclecloud|successfactor|impactpool|reliefweb|profilrdc|achatpublic|arsp\.cd|sigmap/i;

const PORTAL_PLATFORMS = new Set([
  'UNGM',
  'DevEx',
  'ReliefWeb',
  'ProfilRDC',
  'AchatPublicRDC',
  'SIGMAP',
  'ARSP'
]);

const PDF_URL_RE = /https?:\/\/[^\s<>"'")]+?\.pdf(?:\?[^\s<>"'")]*)?/gi;
const MAILTO_RE = /mailto:([A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,})/gi;
const HTTP_URL_RE = /https?:\/\/[^\s<>"'")]+/gi;

function uniqueStrings(list) {
  const out = [];
  for (const raw of list || []) {
    const v = String(raw || '').trim();
    if (v && !out.includes(v)) out.push(v);
  }
  return out;
}

function uniqueLinks(list) {
  const seen = new Set();
  const out = [];
  for (const item of list || []) {
    const url = String(item?.url || '').trim();
    if (!url || seen.has(url)) continue;
    seen.add(url);
    out.push({ url, label: String(item.label || url).slice(0, 200) });
  }
  return out;
}

function extractPdfUrlsFromText(text = '') {
  return uniqueStrings(String(text).match(PDF_URL_RE) || []).map((url) => ({
    url,
    label: url.split('/').pop() || url
  }));
}

function extractPdfLinksFromHtml(html, baseUrl) {
  const $ = loadCheerio(html);
  const links = [];
  $('a[href]').each((_, a) => {
    const href = $(a).attr('href') || '';
    const label = $(a).text().replace(/\s+/g, ' ').trim();
    const abs = absoluteUrl(baseUrl, href);
    if (/\.pdf(\?|#|$)/i.test(abs) || /\.pdf(\?|#|$)/i.test(href)) {
      if (/^https?:/i.test(abs)) {
        links.push({ url: abs, label: label || abs });
      }
    }
  });
  return uniqueLinks(links);
}

function extractPortalFromHtml(html, baseUrl) {
  const $ = loadCheerio(html);
  let found = '';
  $('a[href]').each((_, a) => {
    if (found) return;
    const href = $(a).attr('href') || '';
    const label = $(a).text().replace(/\s+/g, ' ').trim();
    const abs = absoluteUrl(baseUrl, href);
    if (PORTAL_HINT.test(`${href} ${label} ${abs}`) && /^https?:/i.test(abs) && !/\.pdf(\?|$)/i.test(abs)) {
      found = abs;
    }
  });
  return found;
}

function extractContactName(text = '') {
  const patterns = [
    /(?:à l['’]attention de|attn|destinataire|personne de contact|contact)\s*[:\-–]?\s*([A-ZÉÈÊÀÂÙÛÎÔÇ][\wÉÈÊÀÂÙÛÎÔÇéèêàâùûîôç'’.\- ]{2,70})/i,
    /envoyer(?:\s+(?:le|la|votre|un|une))?\s+(?:cv|candidature|dossier|lettre).{0,50}?\sà\s+([A-ZÉÈÊÀÂÙÛÎÔÇ][\wÉÈÊÀÂÙÛÎÔÇéèêàâùûîôç'’.\- ]{2,70})/i
  ];
  for (const re of patterns) {
    const m = String(text).match(re);
    const name = m?.[1]?.replace(/\s+/g, ' ').trim();
    if (name && !/@/.test(name) && name.length < 80) return name;
  }
  return '';
}

function extractRequiredDocs(text = '') {
  const found = [];
  const lower = String(text).toLowerCase();
  const checks = [
    [/cv|curriculum/i, 'CV'],
    [/lettre de motivation|manifestation d['’]intérêt|ami\b/i, 'Lettre de motivation / AMI'],
    [/diplôme|attestation|certificat/i, 'Diplômes / attestations'],
    [/offre technique|proposition technique/i, 'Offre technique'],
    [/offre financière|proposition financière/i, 'Offre financière'],
    [/registre de commerce|rccm|idnat/i, 'Documents légaux (RCCM / IDNAT)'],
    [/agr[ée]ment|attestation fiscale/i, 'Agrément / attestation fiscale']
  ];
  for (const [re, label] of checks) {
    if (re.test(lower) && !found.includes(label)) found.push(label);
  }
  return found;
}

function sourceLabelFor({ emails, source }) {
  if (emails.length && source === 'scraped_text') {
    return 'Email trouvé dans le texte de l’offre';
  }
  if (emails.length && source === 'source_page_refetch') {
    return 'Email trouvé sur la page source (absent de l’extrait scrapé) — à vérifier avant envoi';
  }
  if (!emails.length) {
    return 'Aucune adresse e-mail confirmée — ne pas inventer de destinataire';
  }
  return 'Email non confirmé, à vérifier avant envoi';
}

function buildFallbackGuide(opp, intel) {
  const lines = [];
  if (intel.method === 'email' && intel.emails[0]) {
    lines.push(
      `Un e-mail de contact a été identifié : ${intel.emails[0]}.`,
      `Objet suggéré : ${intel.suggestedSubject}`,
      `Joindre les pièces demandées (au minimum : ${(intel.requiredDocuments || []).join(', ') || 'CV et lettre'}).`,
      'Rédigez le message hors de M-ECAL (Outlook, Gmail web, etc.) puis revenez sur Candidatures pour enregistrer la date d’envoi réelle.'
    );
  } else if (intel.method === 'portal' && (intel.portalUrl || opp.sourceUrl)) {
    const url = intel.portalUrl || opp.sourceUrl;
    lines.push(
      'Aucun e-mail de dépôt n’a été trouvé. Un portail ou une page de candidature est indiqué.',
      `Lien : ${url}`,
      'Ouvrez le lien, créez/connectez le compte si demandé, déposez CV et lettre, puis notez le numéro de dossier sur /applications.'
    );
  } else if (intel.method === 'pdf') {
    lines.push(
      'Aucune méthode de candidature explicite (e-mail ou portail) n’apparaît dans le texte.',
      'Un ou plusieurs PDF sont liés : les coordonnées de dépôt y figurent souvent (ARMP / ARSP / DAO).',
      ...(intel.pdfLinks || []).map((p) => `PDF : ${p.label} — ${p.url}`)
    );
  } else {
    lines.push(
      'Aucune méthode de candidature explicite trouvée dans cette offre.',
      'Actions possibles : ouvrir le site officiel de l’organisation, chercher un contact RH sur LinkedIn, appeler un numéro présent dans l’annonce, relire un PDF d’avis s’il existe.'
    );
    if (opp.sourceUrl) lines.push(`Page source : ${opp.sourceUrl}`);
  }
  return lines.join('\n\n');
}

function buildFallbackStrategy(opp, profile) {
  const services = Array.isArray(profile.services) ? profile.services.join(', ') : profile.description || 'services logistiques M-ECAL';
  return [
    `Mettre en avant l’expérience M-ECAL en RDC (${profile.cities?.join(', ') || 'Kinshasa, Goma, Bukavu'}) et les services : ${services}.`,
    `Relier clairement la demande (« ${String(opp.title || '').slice(0, 120)} ») aux références internes (formations, inventaires, consultance) sans inventer de mission.`,
    'Ton : professionnel, factuel, sans superlatifs vides. Respecter toute consigne du type « dossiers incomplets non examinés ».',
    profile.projectReferences
      ? `Références à citer avec parcimonie : ${String(profile.projectReferences).slice(0, 400)}`
      : 'Si une exigence de l’avis n’est pas couverte par le profil, le dire clairement plutôt que forcer.'
  ].join('\n\n');
}

async function fetchSourcePage(sourceUrl) {
  const html = await fetchHtml(sourceUrl, { timeout: 20000 });
  const $ = loadCheerio(html);
  $('script, style, noscript').remove();
  const pageText = $('body').text().replace(/\s+/g, ' ').trim().slice(0, 40000);
  return { html, pageText };
}

async function loadStrategyContext() {
  const profile = (await SystemSetting.findOne({ key: 'mecal_profile' }).lean())?.value || {};
  const recent = await Application.find({ status: { $in: ['won', 'submitted', 'interview', 'pending'] } })
    .sort({ updatedAt: -1 })
    .limit(6)
    .populate('opportunity', 'title organization')
    .select('notes status')
    .lean();
  const wins = recent
    .map((a) => {
      const t = a.opportunity?.title || '';
      const org = a.opportunity?.organization || '';
      const n = String(a.notes || '').slice(0, 180);
      return [t, org, n].filter(Boolean).join(' — ');
    })
    .filter(Boolean);
  return { profile, wins };
}

async function generateGuideTexts(opp, intel, { profile, wins }) {
  const fallbackInstructions = buildFallbackGuide(opp, intel);
  const fallbackStrategy = buildFallbackStrategy(opp, profile);

  const prompt = `Tu aides Maison ECAL (cabinet de conseil logistique en RDC) à POSTULER MANUELLEMENT.
N'invente JAMAIS d'e-mail, de téléphone ou de nom de contact. Si une info n'est pas dans les FAITS, dis qu'elle est absente.

FAITS EXTRAITS (ne pas enrichir) :
- Méthode : ${intel.method}
- E-mails trouvés : ${intel.emails.join(', ') || '(aucun)'}
- Nom contact extrait : ${intel.contactName || '(aucun)'}
- Portail : ${intel.portalUrl || '(aucun)'}
- PDF : ${(intel.pdfLinks || []).map((p) => p.url).join('\n') || '(aucun)'}
- Source info : ${intel.sourceLabel}
- Pièces possibles : ${(intel.requiredDocuments || []).join(', ') || '(non listées)'}

OFFRE :
- Titre : ${opp.title}
- Organisation : ${opp.organization || '—'}
- Plateforme : ${opp.platform || '—'}
- URL : ${opp.sourceUrl || '—'}
- Texte scrapé :
"""${String(opp.description || '').slice(0, 6000)}"""

PROFIL M-ECAL :
${JSON.stringify({
    companyName: profile.companyName,
    director: profile.director,
    services: profile.services,
    cities: profile.cities,
    yearsExperience: profile.yearsExperience,
    projectReferences: String(profile.projectReferences || '').slice(0, 600),
    description: String(profile.description || '').slice(0, 400)
  })}
Candidatures récentes (contexte, ne pas copier) : ${wins.join(' | ') || '(aucune)'}

Rédige DEUX blocs en français, TEXTE BRUT sans Markdown (pas de **, *, #, _) :

BLOC 1 — INSTRUCTIONS
Étapes concrètes pour CETTE offre (e-mail OU portail OU PDF OU rien trouvé).
Si e-mail : objet suggéré, pièces, format/délai si présents dans l'avis.
Si portail : comment naviguer à partir du texte/lien.
Si rien : phrase exacte « Aucune méthode de candidature explicite trouvée dans cette offre » puis actions (site officiel, LinkedIn RH, téléphone de l'annonce).

BLOC 2 — CONSEILS STRATEGIQUES
Points forts M-ECAL à mettre en avant pour CETTE offre, ton, expérience à citer, exigences à respecter à la lettre.

Réponds exactement :
INSTRUCTIONS:
...
CONSEILS:
...`;

  try {
    const raw = stripMarkdown(
      await callAIText(prompt, 'Tu es un conseiller candidatures M-ECAL. Texte brut uniquement. N’invente aucun contact.', 2500)
    );
    const inst = raw.split(/CONSEILS\s*:/i);
    const instructions = stripMarkdown((inst[0] || '').replace(/^INSTRUCTIONS\s*:/i, '')).trim() || fallbackInstructions;
    const strategy = stripMarkdown(inst[1] || '').trim() || fallbackStrategy;
    return { instructions, strategy };
  } catch (e) {
    logger.warn(`applyGuide IA indisponible: ${e.message}`);
    return { instructions: fallbackInstructions, strategy: fallbackStrategy };
  }
}

export async function buildApplyIntel(opp) {
  const scraped = [opp.description, opp.title, opp.organization, opp.location].filter(Boolean).join('\n');
  let emails = extractContactEmails(scraped);
  const mailto = [...String(scraped).matchAll(MAILTO_RE)].map((m) => m[1].toLowerCase());
  emails = uniqueStrings([...emails, ...mailto]);
  let source = emails.length ? 'scraped_text' : 'none';
  let refetchError = '';
  let pageText = '';
  let html = '';
  let pdfLinks = extractPdfUrlsFromText(scraped);
  let portalUrl = '';

  const pageUrls = uniqueStrings(String(scraped).match(HTTP_URL_RE) || []).filter((u) => PORTAL_HINT.test(u) && !/\.pdf/i.test(u));
  if (pageUrls[0]) portalUrl = pageUrls[0];

  if (!emails.length && opp.sourceUrl) {
    try {
      const fetched = await fetchSourcePage(opp.sourceUrl);
      html = fetched.html;
      pageText = fetched.pageText;
      const pageEmails = extractContactEmails(`${html}\n${pageText}`);
      const pageMailto = [...String(html).matchAll(MAILTO_RE)].map((m) => m[1].toLowerCase());
      const merged = uniqueStrings([...pageEmails, ...pageMailto]);
      if (merged.length) {
        emails = merged;
        source = 'source_page_refetch';
      }
      pdfLinks = uniqueLinks([...pdfLinks, ...extractPdfLinksFromHtml(html, opp.sourceUrl), ...extractPdfUrlsFromText(pageText)]);
      portalUrl = portalUrl || extractPortalFromHtml(html, opp.sourceUrl);
    } catch (e) {
      refetchError = e.message || 'Échec du nouvel accès à la page source';
      logger.warn(`applyGuide refetch ${opp.sourceUrl}: ${refetchError}`);
    }
  } else if (opp.sourceUrl && emails.length) {
    try {
      const fetched = await fetchSourcePage(opp.sourceUrl);
      pdfLinks = uniqueLinks([...pdfLinks, ...extractPdfLinksFromHtml(fetched.html, opp.sourceUrl)]);
      portalUrl = portalUrl || extractPortalFromHtml(fetched.html, opp.sourceUrl);
    } catch {
      /* optional enrichment */
    }
  }

  if (!portalUrl && PORTAL_PLATFORMS.has(opp.platform) && opp.sourceUrl) {
    portalUrl = opp.sourceUrl;
  }

  const combinedText = `${scraped}\n${pageText}`;
  const contactName = extractContactName(combinedText);
  const requiredDocuments = extractRequiredDocs(combinedText);

  let method = 'unknown';
  if (emails.length) method = 'email';
  else if (portalUrl) method = 'portal';
  else if (pdfLinks.length) method = 'pdf';

  const confidence = emails.length && source === 'scraped_text' ? 'confirmed' : emails.length ? 'unconfirmed' : 'unconfirmed';
  const sourceLabel = sourceLabelFor({ emails, source });
  const suggestedSubject = `Candidature — ${opp.title || 'offre'}`;

  const intelBase = {
    analyzedAt: new Date(),
    method,
    emails,
    contactName,
    contactRole: '',
    portalUrl: portalUrl || '',
    portalHint: portalUrl && method === 'portal' ? 'Lien de portail ou page d’avis identifié — vérifier le parcours de dépôt' : '',
    pdfLinks,
    source,
    sourceLabel,
    confidence,
    suggestedSubject,
    requiredDocuments,
    instructions: '',
    strategy: '',
    refetchError
  };

  const ctx = await loadStrategyContext();
  const texts = await generateGuideTexts(opp, intelBase, ctx);
  return {
    ...intelBase,
    instructions: texts.instructions,
    strategy: texts.strategy
  };
}

export async function getApplyGuide(opportunityId, { refresh = false } = {}) {
  const opp = await Opportunity.findById(opportunityId);
  if (!opp) {
    const err = new Error('Opportunité introuvable.');
    err.status = 404;
    throw err;
  }
  if (!refresh && opp.applyIntel?.analyzedAt && (opp.applyIntel.instructions || opp.applyIntel.method)) {
    return opp.applyIntel.toObject?.() || opp.applyIntel;
  }
  const intel = await buildApplyIntel(opp.toObject());
  opp.applyIntel = intel;
  await opp.save();
  return intel;
}
