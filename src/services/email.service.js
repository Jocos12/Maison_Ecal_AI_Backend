import nodemailer from 'nodemailer';
import logger from '../utils/logger.js';

function parseBool(value, fallback) {
  if (value === undefined || value === null || value === '') return fallback;
  return ['1', 'true', 'yes', 'on'].includes(String(value).toLowerCase());
}

function smtpConfig() {
  const port = Number(process.env.SMTP_PORT || process.env.EMAIL_PORT || 587);
  const rejectUnauthorized = parseBool(process.env.SMTP_TLS_REJECT_UNAUTHORIZED, true);
  const cfg = {
    host: process.env.SMTP_HOST || process.env.EMAIL_HOST || 'smtp.gmail.com',
    port,
    secure: parseBool(process.env.SMTP_SECURE, port === 465),
    auth: {
      user: process.env.SMTP_USER || process.env.EMAIL_USER,
      pass: process.env.SMTP_PASS || process.env.EMAIL_PASS
    }
  };

  if (!rejectUnauthorized) {
    cfg.tls = { rejectUnauthorized: false };
  }

  return cfg;
}

export function isSmtpConfigured() {
  const c = smtpConfig();
  return Boolean(c.auth.user && c.auth.pass);
}

function getTransport() {
  const cfg = smtpConfig();
  if (!cfg.auth.user || !cfg.auth.pass) return null;
  return nodemailer.createTransport(cfg);
}

const fromAddress = () =>
  process.env.SMTP_FROM || process.env.SMTP_USER || process.env.EMAIL_USER || 'noreply@mecal.local';

function escapeHtml(s) {
  return String(s || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function wrapHtml(title, inner) {
  return `<!DOCTYPE html>
<html lang="fr">
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>${title}</title></head>
<body style="margin:0;background:#0f172a;padding:32px 16px;font-family:Inter,Segoe UI,system-ui,sans-serif;color:#e2e8f0;">
  <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="max-width:560px;margin:0 auto;">
    <tr><td style="background:linear-gradient(135deg,#1e293b 0%,#0f172a 100%);border:1px solid rgba(255,255,255,0.1);border-radius:16px;padding:32px 28px;">
      <div style="font-size:22px;font-weight:800;color:#3b82f6;letter-spacing:-0.02em;">M-ECAL</div>
      <div style="font-size:12px;color:#94a3b8;margin-top:4px;">Moniteur d'opportunités logistiques — RDC</div>
      <div style="height:24px"></div>
      ${inner}
      <div style="height:24px"></div>
      <div style="font-size:11px;color:#64748b;border-top:1px solid rgba(255,255,255,0.08);padding-top:16px;">
        Ce message a été envoyé automatiquement par la plateforme M-ECAL.
      </div>
    </td></tr>
  </table>
</body></html>`;
}

export async function sendOtpEmail(to, code) {
  const transport = getTransport();
  if (!transport) {
    logger.warn('SMTP not configured — OTP email skipped');
    return { sent: false };
  }
  const html = wrapHtml(
    'Vérification M-ECAL',
    `<p style="margin:0 0 16px;font-size:15px;line-height:1.6;">Voici votre code de vérification :</p>
    <div style="text-align:center;margin:24px 0;padding:20px 16px;background:rgba(59,130,246,0.12);border:1px solid rgba(59,130,246,0.35);border-radius:12px;">
      <span style="font-size:2rem;font-weight:700;letter-spacing:0.35em;color:#60a5fa;font-family:ui-monospace,monospace;">${code}</span>
    </div>
    <p style="margin:0;font-size:13px;color:#94a3b8;">Ce code expire dans <strong style="color:#e2e8f0;">10 minutes</strong>.</p>
    <p style="margin:16px 0 0;font-size:13px;color:#94a3b8;">Si vous n'avez pas demandé ce code, ignorez cet e-mail.</p>`
  );
  await transport.sendMail({
    from: fromAddress(),
    to,
    subject: '🔐 Votre code de vérification M-ECAL',
    html
  });
  return { sent: true };
}

export async function sendWelcomeEmail(to, name) {
  const transport = getTransport();
  if (!transport) {
    logger.warn('SMTP not configured — welcome email skipped');
    return { sent: false };
  }
  const base = process.env.FRONTEND_URL || 'http://localhost:5173';
  const html = wrapHtml(
    'Bienvenue M-ECAL',
    `<p style="margin:0 0 12px;font-size:16px;">Bonjour <strong style="color:#fff;">${escapeHtml(name)}</strong>,</p>
    <p style="margin:0 0 16px;font-size:14px;line-height:1.65;color:#cbd5e1;">
      Bienvenue sur <strong style="color:#3b82f6;">M-ECAL</strong>, votre moniteur d'opportunités logistiques pour la RDC.
      Retrouvez formations, consultance, inventaires, études de marché et appels d'offres filtrés pour la Maison M-ECAL.
    </p>
    <div style="text-align:center;margin:28px 0;">
      <a href="${base}/dashboard" style="display:inline-block;padding:14px 28px;border-radius:12px;background:linear-gradient(135deg,#3b82f6,#2563eb);color:#fff;font-weight:700;text-decoration:none;font-size:14px;box-shadow:0 10px 25px rgba(37,99,235,0.35);">Accéder à la plateforme</a>
    </div>
    <p style="margin:0;font-size:12px;color:#64748b;">L'équipe M-ECAL vous souhaite une excellente prospection.</p>`
  );
  await transport.sendMail({
    from: fromAddress(),
    to,
    subject: '👋 Bienvenue sur M-ECAL !',
    html
  });
  return { sent: true };
}

export async function sendPasswordResetEmail(to, resetUrl) {
  const transport = getTransport();
  if (!transport) {
    logger.warn('SMTP not configured — reset email skipped');
    return { sent: false };
  }
  const html = wrapHtml(
    'Réinitialisation M-ECAL',
    `<p style="margin:0 0 16px;font-size:15px;line-height:1.6;">Vous avez demandé la réinitialisation de votre mot de passe.</p>
    <div style="text-align:center;margin:28px 0;">
      <a href="${escapeHtml(resetUrl)}" style="display:inline-block;padding:14px 28px;border-radius:12px;background:linear-gradient(135deg,#3b82f6,#2563eb);color:#fff;font-weight:700;text-decoration:none;font-size:14px;box-shadow:0 10px 25px rgba(37,99,235,0.35);">Réinitialiser mon mot de passe</a>
    </div>
    <p style="margin:0;font-size:13px;color:#94a3b8;">Ce lien expire dans <strong style="color:#e2e8f0;">15 minutes</strong>.</p>
    <p style="margin:16px 0 0;font-size:12px;color:#64748b;">Si vous n'êtes pas à l'origine de cette demande, ignorez cet e-mail — votre mot de passe ne sera pas modifié.</p>`
  );
  await transport.sendMail({
    from: fromAddress(),
    to,
    subject: '🔑 Réinitialisation de votre mot de passe M-ECAL',
    html
  });
  return { sent: true };
}
