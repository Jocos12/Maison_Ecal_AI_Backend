import { Router } from 'express';
import SystemSetting from '../models/SystemSetting.js';
import GmailToken from '../models/GmailToken.js';
import { SERVICES_MECAL } from '../config/businessRules.js';
import { requireManager } from '../middleware/roles.js';
import { pickKnown } from '../utils/requestSafety.js';

const router = Router();

const DEFAULT_SETTINGS = {
  profileName: 'Ghislain / M-ECAL',
  interfaceLanguage: 'fr',
  emailIntegration: true,
  whatsappIntegration: false,
  apiIntegrations: {
    googleCustomSearch: false,
    openAiScoring: false
  }
};

const SETTINGS_FIELDS = ['profileName', 'interfaceLanguage', 'emailIntegration', 'whatsappIntegration', 'apiIntegrations'];
const PROFILE_FIELDS = [
  'companyName', 'director', 'email', 'phone', 'address', 'services', 'cities',
  'yearsExperience', 'projectReferences', 'description', 'emailTone'
];

export const DEFAULT_PROFILE = {
  companyName: "Maison d'Études, de Conseil et d'Assistance Logistique",
  director: 'Ghislain',
  email: 'maisonecal@gmail.com',
  phone: '+243',
  address: 'RDC',
  services: SERVICES_MECAL,
  cities: ['Kinshasa', 'Goma', 'Bukavu', 'Lubumbashi', 'Kalemie'],
  yearsExperience: '',
  projectReferences: '',
  description: 'M-ECAL accompagne les organisations en RDC dans les services logistiques, les formations, les inventaires, les études de marchés et la consultance.',
  anthropicConfigured: Boolean(process.env.ANTHROPIC_API_KEY),
  emailTone: 'formel'
};

router.get('/', async (_req, res, next) => {
  try {
    const doc = await SystemSetting.findOne({ key: 'app' }).lean();
    res.json({ ...DEFAULT_SETTINGS, ...(doc?.value || {}) });
  } catch (e) {
    next(e);
  }
});

router.put('/', requireManager, async (req, res, next) => {
  try {
    const value = { ...DEFAULT_SETTINGS, ...pickKnown(req.body, SETTINGS_FIELDS) };
    const doc = await SystemSetting.findOneAndUpdate(
      { key: 'app' },
      { $set: { value } },
      { new: true, upsert: true }
    );
    res.json(doc.value);
  } catch (e) {
    next(e);
  }
});

router.get('/profile', async (_req, res, next) => {
  try {
    const [doc, gmail] = await Promise.all([
      SystemSetting.findOne({ key: 'mecal_profile' }).lean(),
      GmailToken.findOne({ userEmail: process.env.GMAIL_USER || 'maisonecal@gmail.com' }).lean()
    ]);
    res.json({
      ...DEFAULT_PROFILE,
      ...(doc?.value || {}),
      anthropicConfigured: Boolean(process.env.ANTHROPIC_API_KEY),
      gmailConnected: Boolean(gmail)
    });
  } catch (e) {
    next(e);
  }
});

router.put('/profile', requireManager, async (req, res, next) => {
  try {
    const incoming = pickKnown(req.body, PROFILE_FIELDS);
    const value = {
      ...DEFAULT_PROFILE,
      ...incoming,
      anthropicConfigured: Boolean(process.env.ANTHROPIC_API_KEY)
    };
    delete value.anthropicApiKey;
    const doc = await SystemSetting.findOneAndUpdate(
      { key: 'mecal_profile' },
      { $set: { value } },
      { new: true, upsert: true }
    );
    res.json(doc.value);
  } catch (e) {
    next(e);
  }
});

export default router;
