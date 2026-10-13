import https from 'https';
import tls from 'tls';
import '../src/loadEnv.js';
import { gmailConfig } from '../src/config/gmail.js';

function describeCert(cert) {
  if (!cert || !Object.keys(cert).length) return null;
  return {
    subject: cert.subject?.CN || cert.subject,
    issuer: cert.issuer?.CN || cert.issuer?.O || cert.issuer,
    valid_to: cert.valid_to
  };
}

function probeHttps(hostname, rejectUnauthorized) {
  return new Promise((resolve) => {
    const req = https.request(
      {
        hostname,
        port: 443,
        path: '/',
        method: 'GET',
        servername: hostname,
        rejectUnauthorized,
        timeout: 12000
      },
      (res) => {
        const sock = res.socket;
        resolve({
          ok: true,
          authorized: sock.authorized !== false,
          status: res.statusCode,
          cert: describeCert(sock.getPeerCertificate?.())
        });
        res.resume();
      }
    );
    req.on('timeout', () => {
      req.destroy();
      resolve({ ok: false, code: 'TIMEOUT' });
    });
    req.on('error', (e) => {
      resolve({ ok: false, code: e.code, message: e.message });
    });
    req.end();
  });
}

function probeTls(host, port, rejectUnauthorized) {
  return new Promise((resolve) => {
    const socket = tls.connect(
      { host, port, servername: host, rejectUnauthorized, timeout: 12000 },
      () => {
        resolve({
          ok: true,
          authorized: socket.authorized,
          authorizationError: socket.authorizationError || null,
          cert: describeCert(socket.getPeerCertificate())
        });
        socket.end();
      }
    );
    socket.on('error', (e) => {
      resolve({ ok: false, code: e.code, message: e.message });
    });
  });
}

const flags = {
  GMAIL_TLS_REJECT_UNAUTHORIZED: process.env.GMAIL_TLS_REJECT_UNAUTHORIZED ?? '(unset, default true unless "false")',
  gmailConfigTlsRejectUnauthorized: gmailConfig().tlsRejectUnauthorized,
  SMTP_TLS_REJECT_UNAUTHORIZED: process.env.SMTP_TLS_REJECT_UNAUTHORIZED ?? '(unset)',
  NODE_TLS_REJECT_UNAUTHORIZED: process.env.NODE_TLS_REJECT_UNAUTHORIZED ?? '(unset)'
};

const targets = [
  ['https oauth2.googleapis.com', () => probeHttps('oauth2.googleapis.com', true)],
  ['https gmail.googleapis.com', () => probeHttps('gmail.googleapis.com', true)],
  ['tls smtp.gmail.com:465', () => probeTls('smtp.gmail.com', 465, true)]
];

const results = {};
for (const [name, fn] of targets) {
  results[name] = await fn();
}

console.log(JSON.stringify({ flags, results }, null, 2));
