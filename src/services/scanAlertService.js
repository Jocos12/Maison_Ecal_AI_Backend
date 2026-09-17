import ScanAlert from '../models/ScanAlert.js';
import logger from '../utils/logger.js';
import { resolveAdminNotifyEmails, sendHtmlEmail } from './email.service.js';

const ADMIN_FALLBACK = 'maisonecal@gmail.com';

export async function recordScanFailureAlert({ scrapeLogId, message, kind = 'pipeline', triggeredBy = '' }) {
  if (!scrapeLogId) return null;
  const text = String(message || 'Scan terminé en erreur').slice(0, 4000);
  const title = kind === 'orphan_restart' ? 'Scan interrompu (redémarrage)' : 'Collecte en erreur';
  try {
    const existing = await ScanAlert.findOne({ scrapeLog: scrapeLogId }).select('_id').lean();
    if (existing) return existing;
    const doc = await ScanAlert.create({
      scrapeLog: scrapeLogId,
      title,
      message: text,
      kind,
      triggeredBy: String(triggeredBy || '')
    });
    logger.error(`Alerte dashboard collecte: ${title} — ${text.slice(0, 300)}`);
    const emails = await resolveAdminNotifyEmails();
    const recipients = [...new Set([ADMIN_FALLBACK, ...emails].filter(Boolean))];
    const html = `<p><strong>${title}</strong></p><pre style="white-space:pre-wrap">${text}</pre><p>Déclencheur : ${triggeredBy || '—'}</p>`;
    for (const to of recipients) {
      try {
        await sendHtmlEmail({ to, subject: `M-ECAL — ${title}`, html });
      } catch (e) {
        logger.warn(`Alerte e-mail scan error vers ${to}: ${e.message}`);
      }
    }
    return doc;
  } catch (e) {
    if (e.code !== 11000) logger.warn(`ScanAlert: ${e.message}`);
    return null;
  }
}

export async function listScanAlerts({ unreadOnly = false, limit = 15 } = {}) {
  const q = unreadOnly ? { readAt: null } : {};
  return ScanAlert.find(q).sort({ createdAt: -1 }).limit(Math.min(40, Number(limit) || 15)).lean();
}

export async function markScanAlertRead(id) {
  return ScanAlert.findByIdAndUpdate(id, { $set: { readAt: new Date() } }, { new: true });
}

export async function markAllScanAlertsRead() {
  const res = await ScanAlert.updateMany({ readAt: null }, { $set: { readAt: new Date() } });
  return { modified: res.modifiedCount ?? 0 };
}
