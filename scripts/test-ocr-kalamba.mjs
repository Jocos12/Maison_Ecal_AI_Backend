import '../src/loadEnv.js';
import { fetchHtml } from '../src/scrapers/utils.js';
import {
  collectArmpAttachmentUrls,
  extractDeadlineFromArmpAttachments
} from '../src/scrapers/pdfDeadline.js';
import { resolveTesseractBin } from '../src/scrapers/tesseractOcr.js';

const url =
  'https://marche.armp-rdc.cd/poste/realisation-des-etudes-detaillees-pour-la-construction-et-lequipent-du-port-sec-de-kalamba-mbuji';
console.log('tesseract', await resolveTesseractBin());
const html = await fetchHtml(url);
console.log('attachments', collectArmpAttachmentUrls(html, url).slice(0, 3));
const att = await extractDeadlineFromArmpAttachments(html, url, { maxImages: 3 });
console.log(JSON.stringify(att, null, 2));
