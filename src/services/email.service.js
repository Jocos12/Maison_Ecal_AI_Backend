import nodemailer from 'nodemailer';
import User from '../models/User.js';
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

export async function sendWelcomeEmail(to, name, { pendingApproval = false } = {}) {
  const transport = getTransport();
  if (!transport) {
    logger.warn('SMTP not configured — welcome email skipped');
    return { sent: false };
  }
  const base = process.env.FRONTEND_URL || 'http://localhost:5173';
  const pendingBlock = pendingApproval
    ? `<p style="margin:0 0 16px;padding:14px 16px;border-radius:12px;background:rgba(245,158,11,0.12);border:1px solid rgba(245,158,11,0.35);font-size:13px;line-height:1.6;color:#fcd34d;">
        Votre inscription est enregistrée. Un administrateur M-ECAL doit <strong style="color:#fff;">valider votre compte</strong> avant votre première connexion. Vous recevrez un e-mail dès l'approbation.
      </p>`
    : '';
  const html = wrapHtml(
    'Bienvenue M-ECAL',
    `<p style="margin:0 0 12px;font-size:16px;">Bonjour <strong style="color:#fff;">${escapeHtml(name)}</strong>,</p>
    <p style="margin:0 0 16px;font-size:14px;line-height:1.65;color:#cbd5e1;">
      Bienvenue sur <strong style="color:#3b82f6;">M-ECAL</strong>, votre moniteur d'opportunités logistiques pour la RDC.
      Retrouvez formations, consultance, inventaires, études de marché et appels d'offres filtrés pour la Maison M-ECAL.
    </p>
    ${pendingBlock}
    <div style="text-align:center;margin:28px 0;">
      <a href="${base}/login" style="display:inline-block;padding:14px 28px;border-radius:12px;background:linear-gradient(135deg,#3b82f6,#2563eb);color:#fff;font-weight:700;text-decoration:none;font-size:14px;box-shadow:0 10px 25px rgba(37,99,235,0.35);">Accéder à la plateforme</a>
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
  const text = [
    'Réinitialisation de votre mot de passe M-ECAL',
    '',
    'Cliquez sur ce lien pour choisir un nouveau mot de passe :',
    resetUrl,
    '',
    'Ce lien expire dans 15 minutes.',
    'Si vous n\'êtes pas à l\'origine de cette demande, ignorez cet e-mail.'
  ].join('\n');

  await transport.sendMail({
    from: fromAddress(),
    to,
    subject: '🔑 Réinitialisation de votre mot de passe M-ECAL',
    html,
    text
  });
  return { sent: true };
}

export async function resolveAdminNotifyEmails() {
  const explicit = (process.env.ADMIN_NOTIFY_EMAIL || process.env.EMAIL_TO || '')
    .split(',')
    .map((e) => e.trim().toLowerCase())
    .filter(Boolean);
  const bootstrap = (process.env.BOOTSTRAP_ADMIN_EMAIL || '').trim().toLowerCase();
  const combined = [...new Set([...explicit, ...(bootstrap ? [bootstrap] : [])])];
  if (combined.length) return combined;

  try {
    const admins = await User.find({
      role: { $in: ['Admin', 'admin'] },
      $or: [{ isApproved: true }, { isApproved: { $exists: false } }]
    })
      .select('email')
      .lean();
    return admins.map((a) => a.email).filter(Boolean);
  } catch {
    return [];
  }
}

export async function sendAdminNewSignupEmail({ name, email, role, createdAt }) {
  const transport = getTransport();
  if (!transport) {
    logger.warn('SMTP not configured — admin signup notification skipped');
    return { sent: false };
  }

  const recipients = await resolveAdminNotifyEmails();
  if (!recipients.length) {
    logger.warn('No admin e-mail configured — signup notification skipped');
    return { sent: false };
  }

  const base = (process.env.FRONTEND_URL || 'http://localhost:5173').replace(/\/$/, '');
  const adminUrl = `${base}/admin/users`;
  const registeredAt = createdAt
    ? new Date(createdAt).toLocaleString('fr-FR')
    : new Date().toLocaleString('fr-FR');

  const html = wrapHtml(
    'Nouvelle inscription M-ECAL',
    `<p style="margin:0 0 16px;font-size:15px;line-height:1.6;">
      Une nouvelle personne vient de s'inscrire sur <strong style="color:#3b82f6;">M-ECAL</strong> et attend votre validation.
    </p>
    <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="margin:20px 0;background:rgba(255,255,255,0.04);border:1px solid rgba(255,255,255,0.08);border-radius:12px;">
      <tr><td style="padding:16px 18px;font-size:14px;line-height:1.8;color:#cbd5e1;">
        <strong style="color:#fff;">Nom :</strong> ${escapeHtml(name)}<br>
        <strong style="color:#fff;">E-mail :</strong> ${escapeHtml(email)}<br>
        <strong style="color:#fff;">Rôle demandé :</strong> ${escapeHtml(role)}<br>
        <strong style="color:#fff;">Date :</strong> ${escapeHtml(registeredAt)}
      </td></tr>
    </table>
    <div style="text-align:center;margin:28px 0;">
      <a href="${adminUrl}" style="display:inline-block;padding:14px 28px;border-radius:12px;background:linear-gradient(135deg,#7c3aed,#4f46e5);color:#fff;font-weight:700;text-decoration:none;font-size:14px;box-shadow:0 10px 25px rgba(79,70,229,0.35);">Valider l'inscription</a>
    </div>
    <p style="margin:0;font-size:12px;color:#64748b;">Ouvrez la page <strong style="color:#94a3b8;">Validation comptes</strong> pour approuver ou rejeter cette demande.</p>`
  );

  await transport.sendMail({
    from: fromAddress(),
    to: recipients.join(', '),
    subject: `🆕 Nouvelle inscription M-ECAL — ${name}`,
    html
  });
  logger.info(`Admin notified of new signup: ${email} → ${recipients.join(', ')}`);
  return { sent: true, recipients };
}

export async function sendAccountApprovedEmail(to, name) {
  const transport = getTransport();
  if (!transport) {
    logger.warn('SMTP not configured — account approved email skipped');
    return { sent: false };
  }

  const base = (process.env.FRONTEND_URL || 'http://localhost:5173').replace(/\/$/, '');
  const loginUrl = `${base}/login`;

  const html = wrapHtml(
    'Compte validé M-ECAL',
    `<p style="margin:0 0 12px;font-size:16px;">Bonjour <strong style="color:#fff;">${escapeHtml(name)}</strong>,</p>
    <p style="margin:0 0 16px;font-size:14px;line-height:1.65;color:#cbd5e1;">
      Bonne nouvelle : un administrateur M-ECAL a <strong style="color:#22c55e;">validé votre compte</strong>.
      Vous pouvez maintenant vous connecter à la plateforme de veille logistique RDC.
    </p>
    <div style="text-align:center;margin:28px 0;">
      <a href="${loginUrl}" style="display:inline-block;padding:14px 28px;border-radius:12px;background:linear-gradient(135deg,#22c55e,#16a34a);color:#fff;font-weight:700;text-decoration:none;font-size:14px;box-shadow:0 10px 25px rgba(34,197,94,0.35);">Se connecter à M-ECAL</a>
    </div>
    <p style="margin:0;font-size:12px;color:#64748b;">Si vous n'avez pas demandé ce compte, contactez l'équipe M-ECAL.</p>`
  );

  await transport.sendMail({
    from: fromAddress(),
    to,
    subject: '✅ Votre compte M-ECAL a été validé',
    html
  });
  logger.info(`Account approved email sent to ${to}`);
  return { sent: true };
}
