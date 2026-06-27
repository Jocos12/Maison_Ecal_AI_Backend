import fs from 'fs/promises';
import path from 'path';
import { launchBrowser } from '../scrapers/utils.js';
import logger from '../utils/logger.js';

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

    if (/^\|.+\|/.test(trimmed) || /@/.test(trimmed) && trimmed.length < 80) {
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

export async function renderDocumentPdf({ filePath, title, content, type }) {
  await fs.mkdir(path.dirname(filePath), { recursive: true });

  const isLetter = type === 'letter';
  const html = `<!DOCTYPE html>
<html lang="fr">
<head>
  <meta charset="utf-8"/>
  <title>${escapeHtml(title)}</title>
  <style>
    @page { size: A4; margin: 0; }
    * { box-sizing: border-box; }
    body {
      font-family: 'Segoe UI', Calibri, Arial, sans-serif;
      margin: 0;
      padding: ${isLetter ? '22mm 20mm' : '18mm 16mm'};
      color: #1e293b;
      line-height: 1.55;
      font-size: ${isLetter ? '11pt' : '10.5pt'};
    }
    h1.doc-title {
      font-size: 14pt;
      margin: 0 0 4px;
      color: #0f172a;
      font-weight: 700;
      letter-spacing: 0.02em;
    }
    .meta {
      font-size: 8.5pt;
      color: #64748b;
      margin-bottom: ${isLetter ? '16px' : '20px'};
      padding-bottom: 8px;
      border-bottom: 1px solid #e2e8f0;
    }
    h2.section {
      font-size: ${isLetter ? '10pt' : '11pt'};
      margin: ${isLetter ? '14px 0 6px' : '16px 0 8px'};
      color: #1d4ed8;
      font-weight: 700;
      text-transform: uppercase;
      letter-spacing: 0.06em;
      border-bottom: 1px solid #dbeafe;
      padding-bottom: 3px;
    }
    p.para { margin: 0 0 10px; text-align: justify; }
    p.letter-para { margin: 0 0 14px; text-align: justify; text-indent: 0; }
    p.contact { margin: 0 0 6px; font-size: 10pt; color: #334155; text-align: center; }
    p.subject { margin: 12px 0 16px; font-size: 10.5pt; }
    p.salutation { margin: 0 0 14px; }
    p.closing { margin: 18px 0 24px; }
    ul.bullets { margin: 4px 0 12px 18px; padding: 0; }
    ul.bullets li { margin-bottom: 5px; }
  </style>
</head>
<body>
  <h1 class="doc-title">${escapeHtml(title)}</h1>
  <div class="meta">M-ECAL — ${isLetter ? 'Lettre de motivation' : 'Curriculum Vitae'} — ${new Date().toLocaleDateString('fr-FR', { day: 'numeric', month: 'long', year: 'numeric' })}</div>
  ${textToHtml(content, type)}
</body>
</html>`;

  let browser;
  try {
    browser = await launchBrowser();
    const page = await browser.newPage();
    await page.setContent(html, { waitUntil: 'networkidle0' });
    await page.pdf({
      path: filePath,
      format: 'A4',
      printBackground: true,
      margin: { top: '12mm', bottom: '14mm', left: '0', right: '0' }
    });
    logger.info(`[JobAssistant] PDF généré: ${filePath}`);
  } finally {
    if (browser) await browser.close();
  }
}
