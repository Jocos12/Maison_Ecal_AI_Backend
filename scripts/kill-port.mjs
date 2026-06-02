/**
 * Libère un port TCP (équivalent kill-port) — Windows + Unix.
 * Usage: node scripts/kill-port.mjs [port]
 */
import { execSync } from 'node:child_process';

const port = process.argv[2] || process.env.PORT || '5000';

function killWindows(targetPort) {
  let out = '';
  try {
    out = execSync(`netstat -ano | findstr :${targetPort}`, { encoding: 'utf8' });
  } catch {
    return;
  }

  const pids = new Set();
  const portRe = new RegExp(`:${targetPort}\\s`);
  for (const line of out.split(/\r?\n/)) {
    if (!/LISTENING/i.test(line) || !portRe.test(line)) continue;
    const parts = line.trim().split(/\s+/);
    const pid = parts[parts.length - 1];
    if (/^\d+$/.test(pid) && pid !== '0') pids.add(pid);
  }

  for (const pid of pids) {
    try {
      execSync(`taskkill /PID ${pid} /F`, { stdio: 'ignore' });
      console.log(`Processus ${pid} arrêté.`);
    } catch {
      // déjà terminé
    }
  }
}

function killUnix(targetPort) {
  try {
    execSync(`lsof -ti tcp:${targetPort} | xargs -r kill -9`, {
      stdio: 'inherit',
      shell: true
    });
  } catch {
    // rien à tuer
  }
}

console.log(`Libération du port ${port}...`);
if (process.platform === 'win32') {
  killWindows(port);
} else {
  killUnix(port);
}
console.log(`Port ${port} prêt.`);
