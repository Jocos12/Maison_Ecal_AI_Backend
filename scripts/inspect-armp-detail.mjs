import '../src/loadEnv.js';
import { fetchHtml } from '../src/scrapers/utils.js';
import axios from 'axios';

const url =
  'https://marche.armp-rdc.cd/poste/realisation-des-etudes-detaillees-pour-la-construction-et-lequipent-du-port-sec-de-kalamba-mbuji';
const html = await fetchHtml(url);
const idx = html.indexOf('IMG_0001');
console.log(html.slice(Math.max(0, idx - 400), idx + 500));

const img = 'https://marche.armp-rdc.cd/wp-content/uploads/2026/08/IMG_0001-10.jpg';
const res = await axios.get(img, {
  responseType: 'arraybuffer',
  timeout: 30000,
  headers: { 'User-Agent': process.env.USER_AGENT || 'M-ECAL-Bot/1.0' }
});
const buf = Buffer.from(res.data);
console.log('img bytes', buf.length, 'magic', buf.slice(0, 8).toString('hex'), buf.slice(0, 5).toString('latin1'));
console.log('content-type', res.headers['content-type']);
