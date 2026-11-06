/**
 * Libère le port de l'API avant `npm run dev` / `npm start` (Windows, macOS, Linux).
 * Usage : node scripts/kill-port.mjs [port]
 *
 * - Le port vient de l'argument, sinon de PORT dans le .env, sinon 5000.
 * - Seuls les processus Node (un ancien serveur resté ouvert) sont arrêtés :
 *   un autre programme sur ce port (ex. AirPlay sur macOS, port 5000) n'est
 *   jamais tué ; le script indique simplement de changer PORT dans le .env.
 */
import { execSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

function portFromEnvFile() {
  try {
    const env = fs.readFileSync(path.join(root, '.env'), 'utf8');
    const m = env.match(/^\s*PORT\s*=\s*(\d+)\s*$/m);
    return m ? m[1] : null;
  } catch {
    return null;
  }
}

const port = process.argv[2] || process.env.PORT || portFromEnvFile() || '5000';

function run(cmd) {
  try {
    return execSync(cmd, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
  } catch {
    return '';
  }
}

/** [{ pid, name }] des processus qui écoutent sur le port. */
function listeners(targetPort) {
  const found = new Map();
  if (process.platform === 'win32') {
    const portRe = new RegExp(`:${targetPort}\\s`);
    for (const line of run('netstat -ano').split(/\r?\n/)) {
      if (!/LISTENING/i.test(line) || !portRe.test(line)) continue;
      const pid = line.trim().split(/\s+/).pop();
      if (!/^\d+$/.test(pid) || pid === '0') continue;
      const name = run(`tasklist /FI "PID eq ${pid}" /FO CSV /NH`).split(',')[0]?.replace(/"/g, '') || '';
      found.set(pid, name);
    }
  } else {
    for (const pid of run(`lsof -ti tcp:${targetPort} -sTCP:LISTEN`).split(/\s+/).filter(Boolean)) {
      found.set(pid, run(`ps -p ${pid} -o comm=`).trim());
    }
  }
  return [...found].map(([pid, name]) => ({ pid, name }));
}

function stop(pid) {
  if (process.platform === 'win32') run(`taskkill /PID ${pid} /F`);
  else run(`kill -9 ${pid}`);
}

console.log(`Libération du port ${port}...`);
let blocked = false;
for (const { pid, name } of listeners(port)) {
  if (/(^|[\\/])node(\.exe)?$/i.test(name)) {
    stop(pid);
    console.log(`Ancien serveur Node arrêté (PID ${pid}).`);
  } else {
    blocked = true;
    console.warn(
      `Le port ${port} est utilisé par « ${name || 'un autre programme'} » (PID ${pid}), qui n'a pas été arrêté.\n` +
        `→ Choisissez un autre port : PORT=5001 dans backend/.env (et VITE_API_PROXY_TARGET côté interface).`
    );
  }
}
if (!blocked) console.log(`Port ${port} prêt.`);
