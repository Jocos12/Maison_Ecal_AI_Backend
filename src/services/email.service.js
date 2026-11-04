import nodemailer from 'nodemailer';
import User from '../models/User.js';
import logger from '../utils/logger.js';
import { isGmailConfigured } from '../config/gmail.js';
import {
  isSystemMailReady,
  sendSystemHtmlEmail,
  getSystemMailStatus
} from './gmailService.js';

function parseBool(value, fallback) {
  if (value === undefined || value === null || value === '') return fallback;
  return ['1', 'true', 'yes', 'on'].includes(String(value).toLowerCase());
}

function normalizeSmtpPass(raw) {
  return String(raw || '').trim().replace(/\s+/g, '');
}

let smtpPassSpacesWarned = false;

function smtpConfig() {
  const port = Number(process.env.SMTP_PORT || process.env.EMAIL_PORT || 587);
  const rejectUnauthorized = parseBool(process.env.SMTP_TLS_REJECT_UNAUTHORIZED, true);
  const rawPass = process.env.SMTP_PASS || process.env.EMAIL_PASS || '';
  if (!smtpPassSpacesWarned && /\s/.test(String(rawPass))) {
    smtpPassSpacesWarned = true;
    logger.warn(
      "SMTP_PASS contient des espaces, ils seront retirés automatiquement (mot de passe d'application Gmail)"
    );
  }
  const cfg = {
    host: process.env.SMTP_HOST || process.env.EMAIL_HOST || 'smtp.gmail.com',
    port,
    secure: parseBool(process.env.SMTP_SECURE, port === 465),
    auth: {
      user: process.env.SMTP_USER || process.env.EMAIL_USER,
      pass: normalizeSmtpPass(rawPass)
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

/** True when OTP / auth e-mails can be attempted (SMTP password and/or Gmail OAuth). */
export function isEmailDeliveryConfigured() {
  return isSmtpConfigured() || isGmailConfigured();
}

function getTransport() {
  const cfg = smtpConfig();
  if (!cfg.auth.user || !cfg.auth.pass) return null;
  return nodemailer.createTransport(cfg);
}

/** Best-effort SMTP auth check for startup diagnostics (does not send mail). */
export async function verifySmtpConnection() {
  if (!isSmtpConfigured()) {
    return { ok: false, configured: false, reason: 'SMTP_USER / SMTP_PASS missing' };
  }
  const transport = getTransport();
  try {
    await transport.verify();
    return { ok: true, configured: true, user: smtpConfig().auth.user };
  } catch (e) {
    return {
      ok: false,
      configured: true,
      user: smtpConfig().auth.user,
      reason: e.message,
      hint:
        'Gmail rejected SMTP login (often 534-5.7.9). Prefer Gmail OAuth: open /api/gmail/system-connect with GMAIL_USER, or set a valid App Password in SMTP_PASS.'
    };
  }
}

export async function getEmailDeliveryStatus() {
  const smtp = await verifySmtpConnection();
  const gmail = await getSystemMailStatus();
  return {
    smtp,
    gmail,
    ready: Boolean(smtp.ok || gmail.connected),
    hint: smtp.ok
      ? null
      : gmail.connected
        ? null
        : 'Connect system mail: GET http://localhost:5000/api/gmail/system-connect (sign in as GMAIL_USER)'
  };
}

const fromAddress = () =>
  process.env.SMTP_FROM ||
  process.env.GMAIL_USER ||
  process.env.SMTP_USER ||
  process.env.EMAIL_USER ||
  'noreply@mecal.local';

function escapeHtml(s) {
  return String(s || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/** Visual system for the three one-time-code e-mails. */
const OTP_VARIANTS = {
  login: {
    subject: 'Votre code de vérification M-ECAL',
    kicker: 'Connexion sécurisée',
    title: 'Votre code de vérification',
    lead: 'Saisissez ces six chiffres dans M-ECAL pour confirmer que c’est bien vous.',
    footnote:
      'Si vous n’avez pas demandé ce code, ignorez cet e-mail. Personne de l’équipe M-ECAL ne vous le demandera jamais.',
    accent: '#24478a',
    ink: '#1b3a73',
    soft: '#eef3fb',
    edge: '#c5d4ee',
    stripe: 'linear-gradient(90deg,#24478a 0%,#2f62b3 55%,#8aafdf 100%)'
  },
  email: {
    subject: 'Confirmez votre nouvelle adresse M-ECAL',
    kicker: 'Nouvelle adresse',
    title: 'Confirmez votre e-mail',
    lead: 'Utilisez ce code pour valider le changement d’adresse de votre compte M-ECAL.',
    footnote:
      'Si vous n’êtes pas à l’origine de cette demande, ignorez cet e-mail. L’adresse de votre compte ne sera pas modifiée.',
    accent: '#0f5f6b',
    ink: '#0c4a52',
    soft: '#e7f6f7',
    edge: '#b7dde1',
    stripe: 'linear-gradient(90deg,#0c3d45 0%,#0f5f6b 50%,#3aa8b5 100%)'
  },
  reset: {
    subject: 'Code de réinitialisation de votre mot de passe M-ECAL',
    kicker: 'Mot de passe',
    title: 'Choisissez un nouveau mot de passe',
    lead: 'Saisissez ce code dans l’application pour définir un nouveau mot de passe.',
    footnote:
      'Si vous n’êtes pas à l’origine de cette demande, ignorez cet e-mail. Votre mot de passe ne sera pas modifié.',
    accent: '#9a5410',
    ink: '#7c3f0c',
    soft: '#fdf6ec',
    edge: '#f0d7b0',
    stripe: 'linear-gradient(90deg,#7c3f0c 0%,#c47a1a 58%,#e8b15a 100%)'
  }
};

function otpDigitsRow(code, tone) {
  const digits = String(code || '').replace(/\s/g, '').split('');
  const cells = digits
    .map(
      (digit) => `<td align="center" valign="middle" width="46" height="58" style="width:46px;height:58px;background-color:${tone.soft};border:1px solid ${tone.edge};border-bottom:3px solid ${tone.accent};border-radius:14px;font-family:'Segoe UI',Helvetica,Arial,sans-serif;font-size:26px;font-weight:700;line-height:58px;color:${tone.ink};">${escapeHtml(digit)}</td>`
    )
    .join('');
  return `<table role="presentation" cellpadding="0" cellspacing="0" align="center" style="border-collapse:separate;border-spacing:8px 0;margin:0 auto;"><tr>${cells}</tr></table>`;
}

/**
 * Pretty, table-based one-time-code e-mail. Inline styles only, so Gmail keeps the layout.
 * @returns {{ subject: string, html: string, text: string }}
 */
export function renderOtpEmail({ code, purpose = 'login' } = {}) {
  const tone = OTP_VARIANTS[purpose] || OTP_VARIANTS.login;
  const safeCode = escapeHtml(String(code || '').replace(/\s/g, ''));
  const spaced = String(code || '')
    .replace(/\s/g, '')
    .split('')
    .join(' ');
  const preheader = `Code M-ECAL : ${safeCode}. Il expire dans 10 minutes.`;
  const pad = '&nbsp;&zwnj;'.repeat(24);

  const html = `<!DOCTYPE html>
<html lang="fr">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <meta name="color-scheme" content="light">
  <meta name="supported-color-schemes" content="light">
  <title>${escapeHtml(tone.subject)}</title>
</head>
<body style="margin:0;padding:0;background-color:#e7eef8;">
  <div style="display:none;max-height:0;overflow:hidden;opacity:0;color:transparent;mso-hide:all;">${preheader}${pad}</div>
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background-color:#e7eef8;">
    <tr>
      <td align="center" style="padding:36px 14px;">
        <!--[if mso]><table role="presentation" width="520" align="center" cellpadding="0" cellspacing="0"><tr><td><![endif]-->
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:520px;width:100%;">
          <tr>
            <td style="background-color:#ffffff;border:1px solid #d5e2f3;border-radius:22px;overflow:hidden;">
              <table role="presentation" width="100%" cellpadding="0" cellspacing="0">
                <tr>
                  <td height="6" style="height:6px;background-color:${tone.accent};background-image:${tone.stripe};font-size:0;line-height:0;">&nbsp;</td>
                </tr>
              </table>
              <table role="presentation" width="100%" cellpadding="0" cellspacing="0">
                <tr>
                  <td style="padding:28px 28px 0;">
                    <table role="presentation" cellpadding="0" cellspacing="0">
                      <tr>
                        <td width="42" height="42" align="center" valign="middle" style="width:42px;height:42px;background-color:${tone.accent};border-radius:13px;font-family:'Segoe UI',Helvetica,Arial,sans-serif;font-size:18px;font-weight:800;line-height:42px;color:#ffffff;">M</td>
                        <td style="padding-left:12px;">
                          <div style="font-family:'Segoe UI',Helvetica,Arial,sans-serif;font-size:15px;font-weight:800;letter-spacing:0.08em;color:#0e1c33;">M-ECAL</div>
                          <div style="font-family:'Segoe UI',Helvetica,Arial,sans-serif;font-size:12px;line-height:1.4;color:#64748b;padding-top:2px;">Moniteur d’opportunités logistiques · RDC</div>
                        </td>
                      </tr>
                    </table>
                  </td>
                </tr>
                <tr>
                  <td style="padding:22px 28px 0;font-family:'Segoe UI',Helvetica,Arial,sans-serif;">
                    <div style="display:inline-block;padding:5px 11px;border-radius:999px;background-color:${tone.soft};color:${tone.accent};font-size:11px;font-weight:700;letter-spacing:0.14em;text-transform:uppercase;">${escapeHtml(tone.kicker)}</div>
                    <h1 style="margin:14px 0 8px;font-size:24px;line-height:1.25;font-weight:700;color:#0e1c33;">${escapeHtml(tone.title)}</h1>
                    <p style="margin:0;font-size:15px;line-height:1.6;color:#475569;">${escapeHtml(tone.lead)}</p>
                  </td>
                </tr>
                <tr>
                  <td align="center" style="padding:26px 16px 0;font-family:'Segoe UI',Helvetica,Arial,sans-serif;">
                    <div style="font-size:11px;font-weight:700;letter-spacing:0.16em;text-transform:uppercase;color:#94a3b8;padding-bottom:12px;">Code à 6 chiffres</div>
                    ${otpDigitsRow(code, tone)}
                  </td>
                </tr>
                <tr>
                  <td align="center" style="padding:18px 28px 0;font-family:'Segoe UI',Helvetica,Arial,sans-serif;">
                    <div style="display:inline-block;padding:8px 14px;border-radius:999px;background-color:#f4f7fb;border:1px solid #e2e8f0;color:#334155;font-size:13px;line-height:1.4;">Valable <strong style="color:${tone.ink};">10 minutes</strong> · à usage unique</div>
                  </td>
                </tr>
                <tr>
                  <td style="padding:22px 28px 28px;font-family:'Segoe UI',Helvetica,Arial,sans-serif;">
                    <div style="padding:14px 16px;background-color:#f8fafc;border:1px solid #e6edf5;border-left:3px solid ${tone.accent};border-radius:12px;font-size:13px;line-height:1.6;color:#64748b;">${escapeHtml(tone.footnote)}</div>
                  </td>
                </tr>
              </table>
            </td>
          </tr>
          <tr>
            <td align="center" style="padding:16px 8px 0;font-family:'Segoe UI',Helvetica,Arial,sans-serif;font-size:12px;line-height:1.6;color:#94a3b8;">
              Message automatique de la plateforme M-ECAL.<br>Merci de ne pas répondre à cet e-mail.
            </td>
          </tr>
        </table>
        <!--[if mso]></td></tr></table><![endif]-->
      </td>
    </tr>
  </table>
</body>
</html>`;

  const text = [
    `M-ECAL — ${tone.title}`,
    '',
    tone.lead,
    '',
    `Votre code : ${spaced}`,
    '',
    'Ce code expire dans 10 minutes et ne sert qu’une seule fois.',
    tone.footnote
  ].join('\n');

  return { subject: tone.subject, html, text };
}

function wrapHtml(title, inner) {
  return `<!DOCTYPE html>
<html lang="fr">
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>${title}</title></head>
<body style="margin:0;background:#0f172a;padding:32px 16px;font-family:Inter,Segoe UI,system-ui,sans-serif;color:#e2e8f0;">
  <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="max-width:560px;margin:0 auto;">
    <tr><td style="background:linear-gradient(135deg,#1e293b 0%,#0f172a 100%);border:1px solid rgba(255,255,255,0.1);border-radius:16px;padding:32px 28px;">
      <div style="font-size:22px;font-weight:800;color:#3b82f6;letter-spacing:-0.02em;">M-ECAL</div>
      <div style="font-size:12px;color:#94a3b8;margin-top:4px;">Moniteur d'opportunités logistiques, RDC</div>
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

/**
 * Deliver auth e-mails: try SMTP App Password first, then Gmail API OAuth.
 */
async function deliverMail({ to, subject, html, text }) {
  const errors = [];

  if (isSmtpConfigured()) {
    try {
      const transport = getTransport();
      await transport.sendMail({
        from: fromAddress(),
        to,
        subject,
        html,
        ...(text ? { text } : {})
      });
      logger.info(`E-mail sent via SMTP → ${to}`);
      return { sent: true, via: 'smtp' };
    } catch (e) {
      errors.push(`smtp: ${e.message}`);
      logger.warn(`SMTP send failed, trying Gmail API: ${e.message}`);
    }
  }

  if (isGmailConfigured() && (await isSystemMailReady())) {
    try {
      await sendSystemHtmlEmail({ to, subject, html });
      logger.info(`E-mail sent via Gmail API → ${to}`);
      return { sent: true, via: 'gmail_api' };
    } catch (e) {
      errors.push(`gmail_api: ${e.message}`);
      logger.warn(`Gmail API send failed: ${e.message}`);
    }
  } else if (isGmailConfigured()) {
    errors.push(
      'gmail_api: not connected — open http://localhost:5000/api/gmail/system-connect'
    );
  }

  if (!errors.length) {
    logger.warn('No e-mail transport configured — mail skipped');
    return { sent: false };
  }

  const err = new Error(`Échec d'envoi e-mail (${errors.join(' | ')})`);
  err.status = 502;
  throw err;
}

export async function sendHtmlEmail({ to, subject, html, text }) {
  return deliverMail({ to, subject, html, text });
}

export async function sendOtpEmail(to, code, { purpose = 'login' } = {}) {
  if (!isEmailDeliveryConfigured()) {
    logger.warn('E-mail not configured — OTP email skipped');
    return { sent: false };
  }
  const variant = purpose === 'email' ? 'email' : 'login';
  const { subject, html, text } = renderOtpEmail({ code, purpose: variant });
  return deliverMail({ to, subject, html, text });
}

export async function sendWelcomeEmail(to, name, { pendingApproval = false } = {}) {
  if (!isEmailDeliveryConfigured()) {
    logger.warn('E-mail not configured — welcome email skipped');
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
  return deliverMail({
    to,
    subject: 'Bienvenue sur M-ECAL !',
    html
  });
}

/** "Forgot password" e-mail: 6-digit code the user types in the app before choosing a new password. */
export async function sendPasswordResetOtpEmail(to, code) {
  if (!isEmailDeliveryConfigured()) {
    logger.warn('E-mail not configured, reset code email skipped');
    return { sent: false };
  }
  const { subject, html, text } = renderOtpEmail({ code, purpose: 'reset' });
  return deliverMail({ to, subject, html, text });
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
  if (!isEmailDeliveryConfigured()) {
    logger.warn('E-mail not configured — admin signup notification skipped');
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

  const result = await deliverMail({
    to: recipients.join(', '),
    subject: `Nouvelle inscription M-ECAL, ${name}`,
    html
  });
  logger.info(`Admin notified of new signup: ${email} → ${recipients.join(', ')}`);
  return { ...result, recipients };
}

export async function sendAccountApprovedEmail(to, name) {
  if (!isEmailDeliveryConfigured()) {
    logger.warn('E-mail not configured — account approved email skipped');
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

  const result = await deliverMail({
    to,
    subject: 'Votre compte M-ECAL a été validé',
    html
  });
  logger.info(`Account approved email sent to ${to}`);
  return result;
}
