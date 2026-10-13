import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';
import { launchBrowser } from '../scrapers/utils.js';
import logger from '../utils/logger.js';
import { splitMaisonEcalMention } from '../utils/maisonEcalLetter.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const LOGO_PATH = path.resolve(__dirname, '../../../frontend/public/favicon.svg');

function escapeHtml(text = '') {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function inlineFormat(text = '') {
  return escapeHtml(text).replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
}

export function isPlaceholderJobTitle(title = '') {
  return /^voir les offres/i.test(String(title)) || /sur (coordination sud|impact pool|reliefweb|mediacongo|unjobnet)/i.test(String(title));
}

export function documentHeading(type) {
  if (type === 'cv') return 'Curriculum vitae';
  if (type === 'recommendation') return 'Lettre de recommandation';
  return 'Lettre de motivation';
}

function textToHtml(content = '', type = 'cv') {
  const lines = String(content).replace(/\r/g, '').split('\n');
  const parts = [];
  let inList = false;

  const closeList = () => {
    if (inList) {
      parts.push('</ul>');
      inList = false;
    }
  };

  for (const raw of lines) {
    const line = raw.trimEnd();
    const trimmed = line.trim();

    if (!trimmed || trimmed === '---') {
      closeList();
      continue;
    }

    if (/appui de Maison ECAL|Maison ECAL,\s*cabinet de conseil/i.test(trimmed)) {
      closeList();
      continue;
    }

    if (/^[A-ZÀÂÄÉÈÊËÏÎÔÙÛÜÇ][A-ZÀÂÄÉÈÊËÏÎÔÙÛÜÇ\s/&-]{2,}$/.test(trimmed) && trimmed.length < 60) {
      closeList();
      parts.push(`<h2 class="section">${escapeHtml(trimmed)}</h2>`);
      continue;
    }

    if (/^#{1,3}\s+/.test(trimmed)) {
      closeList();
      parts.push(`<h2 class="section">${escapeHtml(trimmed.replace(/^#+\s*/, ''))}</h2>`);
      continue;
    }

    if (/, le \d{1,2}\s+\S+\s+\d{4}/i.test(trimmed) && trimmed.length < 80) {
      closeList();
      parts.push(`<p class="dateline">${inlineFormat(trimmed)}</p>`);
      continue;
    }

    if (/^objet\s*:/i.test(trimmed)) {
      closeList();
      parts.push(`<p class="subject"><strong>${inlineFormat(trimmed)}</strong></p>`);
      continue;
    }

    if (/^madame|^monsieur|^cher /i.test(trimmed)) {
      closeList();
      parts.push(`<p class="salutation">${inlineFormat(trimmed)}</p>`);
      continue;
    }

    if (/^dans l'attente|^je vous prie|^cordialement|^salutations/i.test(trimmed)) {
      closeList();
      parts.push(`<p class="closing">${inlineFormat(trimmed)}</p>`);
      continue;
    }

    if (/^[•\-–]\s+/.test(trimmed)) {
      if (!inList) {
        parts.push('<ul class="bullets">');
        inList = true;
      }
      parts.push(`<li>${inlineFormat(trimmed.replace(/^[•\-–]\s+/, ''))}</li>`);
      continue;
    }

    if ((/^\|.+\|/.test(trimmed) || /@/.test(trimmed)) && trimmed.length < 80) {
      closeList();
      parts.push(`<p class="contact">${inlineFormat(trimmed)}</p>`);
      continue;
    }

    closeList();
    const cls = type === 'letter' ? 'para letter-para' : 'para';
    parts.push(`<p class="${cls}">${inlineFormat(trimmed)}</p>`);
  }

  closeList();
  return parts.join('\n');
}

const ECAL_LOGO_FALLBACK = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64" width="44" height="44">
  <rect width="64" height="64" rx="14" fill="#1e3a5f"/>
  <path d="M12 45 32 18l20 27H12Z" fill="#2563eb"/>
  <path d="M23 45V32h18v13" fill="#f8fafc"/>
</svg>`;

async function loadLogoMarkup() {
  try {
    const raw = await fs.readFile(LOGO_PATH, 'utf8');
    return raw.replace('<svg', '<svg width="44" height="44"');
  } catch {
    return ECAL_LOGO_FALLBACK;
  }
}

export function buildDocumentHtml({
  heading,
  content,
  type,
  jobTitle = '',
  organization = '',
  logoMarkup = ECAL_LOGO_FALLBACK
}) {
  const isLetter = type === 'letter' || type === 'recommendation';
  const { body, footer } = isLetter
    ? splitMaisonEcalMention(content)
    : { body: content, footer: '' };
  const subtitleParts = [];
  if (jobTitle && !isPlaceholderJobTitle(jobTitle)) subtitleParts.push(jobTitle);
  if (organization && organization !== 'Non précisé' && organization !== 'Maison ECAL') {
    subtitleParts.push(organization);
  }

  return `<!DOCTYPE html>
<html lang="fr">
<head>
  <meta charset="utf-8"/>
  <title>${escapeHtml(heading)}</title>
  <style>
    @page { size: A4; margin: 0; }
    * { box-sizing: border-box; }
    body {
      font-family: Calibri, "Segoe UI", Arial, sans-serif;
      margin: 0;
      color: #1e293b;
      font-size: ${isLetter ? '11.5pt' : '10.5pt'};
      line-height: 1.65;
    }
    .sheet {
      padding: ${isLetter ? '18mm 22mm 28mm' : '16mm 18mm 24mm'};
      min-height: 277mm;
    }
    header.brand {
      display: flex;
      align-items: center;
      gap: 14px;
      padding-bottom: 14px;
      margin-bottom: 18px;
      border-bottom: 3px solid #1e3a5f;
    }
    header.brand .mark { flex-shrink: 0; }
    header.brand h1 {
      margin: 0;
      font-size: 18pt;
      font-weight: 700;
      color: #1e3a5f;
      letter-spacing: 0.04em;
    }
    header.brand p.tag {
      margin: 2px 0 0;
      font-size: 8pt;
      text-transform: uppercase;
      letter-spacing: 0.14em;
      color: #2563eb;
    }
    h2.doc-heading {
      font-size: 13.5pt;
      margin: 0 0 6px;
      color: #0f172a;
      font-weight: 700;
    }
    p.doc-sub {
      margin: 0 0 22px;
      font-size: 10pt;
      color: #475569;
    }
    h2.section {
      font-size: 10.5pt;
      margin: 18px 0 8px;
      color: #1e3a5f;
      font-weight: 700;
      text-transform: uppercase;
      letter-spacing: 0.08em;
      border-bottom: 1px solid #bfdbfe;
      padding-bottom: 4px;
    }
    p.para { margin: 0 0 10px; text-align: justify; }
    p.letter-para { margin: 0 0 16px; text-align: justify; }
    p.contact { margin: 0 0 4px; font-size: 10.5pt; color: #1e3a5f; font-weight: 600; }
    p.dateline { margin: 0 0 18px; text-align: right; color: #334155; }
    p.subject { margin: 4px 0 20px; font-size: 11pt; color: #0f172a; }
    p.salutation { margin: 0 0 16px; }
    p.closing { margin: 22px 0 8px; }
    ul.bullets { margin: 4px 0 14px 18px; padding: 0; }
    ul.bullets li { margin-bottom: 6px; }
    footer.legal {
      margin-top: 28px;
      padding-top: 12px;
      border-top: 1px solid #cbd5e1;
      font-size: 8.5pt;
      line-height: 1.45;
      color: #64748b;
      font-style: italic;
    }
  </style>
</head>
<body>
  <div class="sheet">
    <header class="brand">
      <div class="mark">${logoMarkup}</div>
      <div>
        <h1>MAISON ECAL</h1>
        <p class="tag">Études · Conseil · Assistance logistique — RDC</p>
      </div>
    </header>
    <h2 class="doc-heading">${escapeHtml(heading)}</h2>
    ${subtitleParts.length ? `<p class="doc-sub">${escapeHtml(subtitleParts.join(' · '))}</p>` : ''}
    ${textToHtml(isLetter ? body : content, isLetter ? 'letter' : 'cv')}
    ${isLetter ? `<footer class="legal">${escapeHtml(footer)}</footer>` : ''}
  </div>
</body>
</html>`;
}

export async function renderDocumentPdf({
  filePath,
  title,
  content,
  type,
  jobTitle = '',
  organization = ''
}) {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  const heading = documentHeading(type);
  const logoMarkup = await loadLogoMarkup();
  const html = buildDocumentHtml({
    heading,
    content,
    type,
    jobTitle,
    organization,
    logoMarkup
  });

  let browser;
  try {
    browser = await launchBrowser();
    const page = await browser.newPage();
    await page.setContent(html, { waitUntil: 'networkidle0' });
    await page.pdf({
      path: filePath,
      format: 'A4',
      printBackground: true,
      margin: { top: '10mm', bottom: '12mm', left: '0', right: '0' }
    });
    logger.info(`[JobAssistant] PDF généré: ${filePath}`);
  } finally {
    if (browser) await browser.close();
  }
}
