import twilio from 'twilio';
import nodemailer from 'nodemailer';
import logger from '../utils/logger.js';

function getTwilioClient() {
  const sid = process.env.TWILIO_ACCOUNT_SID;
  const token = process.env.TWILIO_AUTH_TOKEN;
  if (!sid || !token) return null;
  return twilio(sid, token);
}

export async function sendWhatsAppNewOpportunity(opportunity) {
  const client = getTwilioClient();
  const from = process.env.TWILIO_WHATSAPP_FROM;
  const to = process.env.ALERT_WHATSAPP_TO;
  if (!client || !from || !to) {
    logger.info('WhatsApp alert skipped (Twilio not configured)');
    return { sent: false };
  }
  const base = process.env.FRONTEND_URL || 'https://maison-ecal.com';
  const link = `${base}/opportunities?id=${opportunity._id}`;
  const body = `🔔 *Nouvelle offre M-ECAL*
📋 ${opportunity.title}
🏢 ${opportunity.organization || '—'}
📂 Catégorie: ${opportunity.category}
🌍 ${opportunity.location || '—'}
⏰ Clôture: ${opportunity.deadline ? new Date(opportunity.deadline).toISOString().slice(0, 10) : '—'}
🔗 Voir: ${link}`;

  await client.messages.create({ from, to, body });
  return { sent: true };
}

let transporter;
function getMailer() {
  if (transporter) return transporter;
  const host = process.env.EMAIL_HOST;
  const user = process.env.EMAIL_USER;
  const pass = process.env.EMAIL_PASS;
  if (!host || !user || !pass) return null;
  transporter = nodemailer.createTransport({
    host,
    port: Number(process.env.EMAIL_PORT || 587),
    secure: false,
    auth: { user, pass }
  });
  return transporter;
}

export async function sendDailyDigestEmail(opportunities, toOverride) {
  const mailer = getMailer();
  const to = toOverride || process.env.EMAIL_TO;
  if (!mailer || !to) {
    logger.info('Email digest skipped (SMTP not configured)');
    return { sent: false };
  }
  const lines = opportunities.map(
    (o) => `- ${o.title} (${o.platform}) — ${o.sourceUrl}`
  );
  const html = `<h2>M-ECAL — opportunités (24h)</h2><ul>${opportunities
    .map((o) => `<li><a href="${o.sourceUrl}">${o.title}</a> — ${o.organization || ''}</li>`)
    .join('')}</ul>`;

  await mailer.sendMail({
    from: process.env.EMAIL_USER,
    to,
    subject: `M-ECAL digest — ${opportunities.length} opportunité(s)`,
    text: lines.join('\n'),
    html
  });
  return { sent: true };
}

export async function sendTestNotification({ email, whatsappTo }) {
  const results = [];
  const mailer = getMailer();
  if (mailer && (email || process.env.EMAIL_TO)) {
    await mailer.sendMail({
      from: process.env.EMAIL_USER,
      to: email || process.env.EMAIL_TO,
      subject: 'M-ECAL — test notification',
      text: 'Ceci est un message de test depuis le moniteur M-ECAL.'
    });
    results.push('email');
  }
  const client = getTwilioClient();
  if (client && process.env.TWILIO_WHATSAPP_FROM && (whatsappTo || process.env.ALERT_WHATSAPP_TO)) {
    await client.messages.create({
      from: process.env.TWILIO_WHATSAPP_FROM,
      to: whatsappTo || process.env.ALERT_WHATSAPP_TO,
      body: 'Test M-ECAL Monitor — notifications OK.'
    });
    results.push('whatsapp');
  }
  return results;
}
