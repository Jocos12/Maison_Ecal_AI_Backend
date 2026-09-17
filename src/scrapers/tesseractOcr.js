import fs from 'fs/promises';
import os from 'os';
import path from 'path';
import { spawn } from 'child_process';
import { fileURLToPath } from 'url';
import logger from '../utils/logger.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const LOCAL_TESSDATA = path.resolve(__dirname, '../../tessdata');

const CANDIDATES = [
  process.env.TESSERACT_PATH,
  path.join(process.env.PROGRAMFILES || 'C:\\Program Files', 'Tesseract-OCR', 'tesseract.exe'),
  path.join(process.env['PROGRAMFILES(X86)'] || 'C:\\Program Files (x86)', 'Tesseract-OCR', 'tesseract.exe'),
  'tesseract'
].filter(Boolean);

let resolvedBin = null;

function run(bin, args) {
  return new Promise((resolve, reject) => {
    const child = spawn(bin, args, { windowsHide: true });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (d) => {
      stdout += d.toString();
    });
    child.stderr.on('data', (d) => {
      stderr += d.toString();
    });
    child.on('error', reject);
    child.on('close', (code) => {
      if (code === 0) resolve({ stdout, stderr });
      else reject(new Error(stderr.trim() || `tesseract exit ${code}`));
    });
  });
}

export async function resolveTesseractBin() {
  if (resolvedBin) return resolvedBin;
  for (const bin of CANDIDATES) {
    try {
      await run(bin, ['--version']);
      resolvedBin = bin;
      logger.info(`Tesseract OCR: ${bin}`);
      return bin;
    } catch {
      /* try next */
    }
  }
  return null;
}

export async function ocrImageBuffer(buffer, { ext = 'jpg', langs = 'fra+eng' } = {}) {
  const bin = await resolveTesseractBin();
  if (!bin) {
    logger.warn('Tesseract introuvable — OCR local indisponible');
    return { text: '', provider: null };
  }
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'mecal-ocr-'));
  const input = path.join(dir, `page.${ext}`);
  try {
    await fs.writeFile(input, buffer);
    const args = [input, 'stdout', '-l', langs, '--psm', '6'];
    try {
      await fs.access(path.join(LOCAL_TESSDATA, 'fra.traineddata'));
      args.push('--tessdata-dir', LOCAL_TESSDATA);
    } catch {
      /* use default tessdata */
    }
    const { stdout } = await run(bin, args);
    return { text: String(stdout || '').replace(/\s+/g, ' ').trim(), provider: 'tesseract' };
  } finally {
    await fs.rm(dir, { recursive: true, force: true }).catch(() => {});
  }
}
