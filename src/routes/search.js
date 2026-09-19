import { Router } from 'express';
import Opportunity from '../models/Opportunity.js';
import Application from '../models/Application.js';
import Source from '../models/Source.js';
import MatchAlert from '../models/MatchAlert.js';
import JobAssistantConversation from '../models/JobAssistantConversation.js';
import User from '../models/User.js';
import logger from '../utils/logger.js';

const router = Router();

const MAX_QUERY_LENGTH = 80;
const MAX_TERMS = 6;
const PER_GROUP = 6;

/** Letters that also match their accented forms, so "etude" finds "Étude" and "consultance" is unaffected. */
const ACCENT_CLASSES = {
  a: 'aàáâãäåāAÀÁÂÃÄÅĀ',
  c: 'cçCÇ',
  e: 'eèéêëēEÈÉÊËĒ',
  i: 'iìíîïīIÌÍÎÏĪ',
  n: 'nñNÑ',
  o: 'oòóôõöōœOÒÓÔÕÖŌŒ',
  u: 'uùúûüūUÙÚÛÜŪ',
  y: 'yýÿYÝ'
};

function fold(text) {
  return String(text || '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase();
}

function escapeRegex(text) {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** Case- and accent-insensitive regex for one typed word. */
function termRegex(term) {
  const pattern = [...fold(term)]
    .map((ch) => (ACCENT_CLASSES[ch] ? `[${ACCENT_CLASSES[ch]}]` : escapeRegex(ch)))
    .join('');
  return new RegExp(pattern, 'i');
}

function parseQuery(raw) {
  const query = String(raw || '').trim().slice(0, MAX_QUERY_LENGTH);
  const terms = query.split(/\s+/).filter(Boolean).slice(0, MAX_TERMS);
  return { query, terms, regexes: terms.map(termRegex) };
}

/** Mongo filter: every typed word must appear in at least one of the given fields. */
function mongoFilter(regexes, fields) {
  return { $and: regexes.map((re) => ({ $or: fields.map((field) => ({ [field]: re })) })) };
}

/** Same rule for records filtered in JavaScript. */
function matchesAll(terms, parts) {
  const haystack = fold(parts.filter(Boolean).join(' '));
  return terms.every((term) => haystack.includes(fold(term)));
}

/** One group failing must not break the whole search. */
async function safely(name, task, fallback = []) {
  try {
    return await task();
  } catch (e) {
    logger.warn(`Search group "${name}" failed: ${e.message}`);
    return fallback;
  }
}

/**
 * GET /api/search?q=...
 * Searches opportunities, applications, sources, match alerts, the user's own job-assistant
 * conversations and (admins only) users. Words are matched in any language, ignoring accents and case.
 */
router.get('/', async (req, res, next) => {
  try {
    const { query, terms, regexes } = parseQuery(req.query.q);
    if (!regexes.length || terms.join('').length < 2) {
      return res.json({ query, groups: {} });
    }

    const role = req.user?.role || req.userRole;
    const isAdmin = ['Admin', 'admin'].includes(role);

    const [opportunities, applications, sources, alerts, conversations, users] = await Promise.all([
      safely('opportunities', async () => {
        const rows = await Opportunity.find(
          mongoFilter(regexes, [
            'title',
            'organization',
            'description',
            'location',
            'ville',
            'category',
            'platform',
            'rawKeywords'
          ])
        )
          .select('title organization category platform location ville deadline isArchived isUrgent isNew')
          .sort({ isArchived: 1, createdAt: -1 })
          .limit(PER_GROUP)
          .lean();
        return rows.map((o) => ({
          id: String(o._id),
          title: o.title,
          organization: o.organization || '',
          category: o.category,
          platform: o.platform,
          place: o.ville || o.location || '',
          deadline: o.deadline || null,
          archived: Boolean(o.isArchived),
          urgent: Boolean(o.isUrgent)
        }));
      }),

      safely('applications', async () => {
        // Applications are shared by the whole team in this app (there is no per-user list).
        const rows = await Application.find()
          .populate('opportunity', 'title organization')
          .sort({ updatedAt: -1 })
          .limit(300)
          .lean();
        return rows
          .filter((a) =>
            matchesAll(terms, [
              a.opportunity?.title,
              a.opportunity?.organization,
              a.notes,
              a.companyReference,
              a.handledBy,
              a.actualRecipientName,
              a.contactPerson?.name,
              a.contactPerson?.email,
              a.status
            ])
          )
          .slice(0, PER_GROUP)
          .map((a) => ({
            id: String(a._id),
            title: a.opportunity?.title || a.companyReference || 'Candidature',
            organization: a.opportunity?.organization || '',
            status: a.status
          }));
      }),

      safely('sources', async () => {
        const rows = await Source.find(mongoFilter(regexes, ['name', 'key', 'description', 'url']))
          .select('name url enabled lastStatus')
          .limit(PER_GROUP)
          .lean();
        return rows.map((s) => ({
          id: String(s._id),
          name: s.name,
          url: s.url,
          enabled: Boolean(s.enabled),
          status: s.lastStatus
        }));
      }),

      safely('alerts', async () => {
        const rows = await MatchAlert.find(mongoFilter(regexes, ['title', 'organization', 'matchReason']))
          .select('title organization opportunity readAt')
          .sort({ createdAt: -1 })
          .limit(PER_GROUP)
          .lean();
        return rows.map((a) => ({
          id: String(a._id),
          title: a.title,
          organization: a.organization || '',
          opportunityId: a.opportunity ? String(a.opportunity) : null,
          unread: !a.readAt
        }));
      }),

      safely('conversations', async () => {
        const rows = await JobAssistantConversation.find({ userId: req.userId })
          .sort({ updatedAt: -1 })
          .limit(200)
          .select('title updatedAt')
          .lean();
        return rows
          .filter((c) => matchesAll(terms, [c.title]))
          .slice(0, PER_GROUP)
          .map((c) => ({ id: String(c._id), title: c.title, updatedAt: c.updatedAt }));
      }),

      isAdmin
        ? safely('users', async () => {
            const rows = await User.find(mongoFilter(regexes, ['name', 'email', 'role']))
              .select('name email role isApproved')
              .limit(PER_GROUP)
              .lean();
            return rows.map((u) => ({
              id: String(u._id),
              name: u.name,
              email: u.email,
              role: u.role,
              approved: u.isApproved !== false
            }));
          })
        : Promise.resolve([])
    ]);

    res.json({
      query,
      groups: { opportunities, applications, sources, alerts, conversations, users }
    });
  } catch (e) {
    next(e);
  }
});

export default router;
