import dotenv from 'dotenv';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const backendRoot = path.resolve(__dirname, '..');
const projectRoot = path.resolve(backendRoot, '..');

const envPaths = [
  process.env.DOTENV_PATH,
  path.join(backendRoot, '.env'),
  path.join(projectRoot, '.env')
].filter(Boolean);

let loadedFrom = null;
for (const envPath of envPaths) {
  if (fs.existsSync(envPath)) {
    dotenv.config({ path: envPath });
    loadedFrom = envPath;
  }
}

if (process.env.NODE_ENV !== 'production') {
  const id = process.env.GMAIL_CLIENT_ID || '';
  const aiKey = (name) => {
    const v = (process.env[name] || '').trim();
    return v ? `${v.slice(0, 8)}...` : 'missing';
  };
  console.log('[loadEnv]', {
    file: loadedFrom || 'aucun .env trouvé',
    gmailClientId: id ? (id.startsWith('REMPLACER_') ? 'placeholder' : 'ok') : 'missing',
    gmailSecret: process.env.GMAIL_CLIENT_SECRET ? 'ok' : 'missing',
    anthropic: aiKey('ANTHROPIC_API_KEY'),
    groq: aiKey('GROQ_API_KEY'),
    gemini: aiKey('GEMINI_API_KEY')
  });
}
