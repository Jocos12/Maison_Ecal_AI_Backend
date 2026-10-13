import path from 'path';
import { fileURLToPath } from 'url';
import { mkdir, writeFile } from 'fs/promises';
import { readFile } from 'fs/promises';
import { buildDocumentHtml, renderDocumentPdf } from '../src/services/jobDocumentPdfService.js';
import { MAISON_ECAL_LETTER_MENTION } from '../src/utils/maisonEcalLetter.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const outDir = path.join(__dirname, '../uploads/job-assistant');

const sample = `Kinshasa, le 16 septembre 2026

Objet : Candidature — Responsable Logistique

Madame, Monsieur,

Fort d'une expérience confirmée en supply chain et en assistance logistique en République Démocratique du Congo, je souhaite vous présenter ma candidature pour le poste de Responsable Logistique.

Mon parcours m'a permis d'accompagner des organisations humanitaires et commerciales sur l'approvisionnement, l'inventaire et la coordination des flux, y compris dans des contextes opérationnels exigeants.

Je reste à votre disposition pour un entretien à Kinshasa ou en visio.

Dans l'attente de votre retour, je vous prie d'agréer, Madame, Monsieur, l'expression de mes salutations distinguées.

Jean COURBON
+243 000 000 000 | jean@maison-ecal.com

${MAISON_ECAL_LETTER_MENTION}`;

await mkdir(outDir, { recursive: true });
const logoPath = path.join(__dirname, '../../frontend/public/favicon.svg');
let logoMarkup = '';
try {
  logoMarkup = (await readFile(logoPath, 'utf8')).replace('<svg', '<svg width="44" height="44"');
} catch {
  logoMarkup = '';
}
const html = buildDocumentHtml({
  heading: 'Lettre de motivation',
  content: sample,
  type: 'letter',
  jobTitle: 'Responsable Logistique',
  organization: 'Organisation partenaire',
  ...(logoMarkup ? { logoMarkup } : {})
});
const htmlPath = path.join(outDir, 'preview-lettre-mecal.html');
const pdfPath = path.join(outDir, 'preview-lettre-mecal.pdf');
await writeFile(htmlPath, html, 'utf8');
await renderDocumentPdf({
  filePath: pdfPath,
  title: 'Lettre de motivation',
  content: sample,
  type: 'letter',
  jobTitle: 'Responsable Logistique',
  organization: 'Organisation partenaire'
});
console.log(htmlPath);
console.log(pdfPath);
