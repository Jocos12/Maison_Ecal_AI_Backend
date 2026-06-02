import { Router } from 'express';
import Opportunity from '../models/Opportunity.js';
import { generateCommercialProposal, generateMarketingSuggestions, generateMotivationLetter, suggestEmailReplies } from '../services/aiClassifierService.js';
import { callAIWithFallback, getProvidersStatus, testAllProviders } from '../services/aiService.js';
import SystemSetting from '../models/SystemSetting.js';

const router = Router();

async function getProfile() {
  const doc = await SystemSetting.findOne({ key: 'mecal_profile' }).lean();
  return doc?.value || {};
}

export async function handleAiStatus(_req, res) {
  const providers = await getProvidersStatus();
  const totalAvailable = Object.values(providers).filter((provider) => provider.configured).length;
  res.json({
    providers,
    totalAvailable,
    message: totalAvailable === 0 ? 'Aucun provider IA disponible' : `${totalAvailable}/3 providers IA actifs`
  });
}

router.get('/status', handleAiStatus);

export async function handleAiTest(_req, res, next) {
  try {
    const results = await testAllProviders();
    res.json({ results });
  } catch (e) {
    next(e);
  }
}

router.get('/test', handleAiTest);

router.post('/test', async (_req, res, next) => {
  try {
    const result = await callAIWithFallback(
      'Dis bonjour en français en une phrase pour M-ECAL.',
      'Tu es un assistant M-ECAL.',
      80
    );
    res.json({ success: true, provider: result.provider, response: result.text });
  } catch (e) {
    next(e);
  }
});

export async function handleAiDebug(_req, res) {
  const mask = (key) => (key && String(key).trim() ? `${String(key).trim().slice(0, 12)}...` : 'MANQUANT');

  const results = {
    providers: await getProvidersStatus(),
    env: {
      groq_key: mask(process.env.GROQ_API_KEY),
      gemini_key: mask(process.env.GEMINI_API_KEY),
      claude_key: mask(process.env.ANTHROPIC_API_KEY),
      groq_model: process.env.GROQ_MODEL || 'llama-3.3-70b-versatile',
      gemini_model: process.env.GEMINI_MODEL || 'gemini-2.0-flash'
    },
    tests: await testAllProviders()
  };

  res.json(results);
}

router.get('/debug', handleAiDebug);

router.post('/opportunities/:id/letter', async (req, res, next) => {
  try {
    const opp = await Opportunity.findById(req.params.id).lean();
    if (!opp) return res.status(404).json({ message: 'Opportunité introuvable.' });
    const letter = await generateMotivationLetter(opp, await getProfile());
    res.json({ letter });
  } catch (e) {
    next(e);
  }
});

router.post('/opportunities/:id/proposal', async (req, res, next) => {
  try {
    const opp = await Opportunity.findById(req.params.id).lean();
    if (!opp) return res.status(404).json({ message: 'Opportunité introuvable.' });
    const proposal = await generateCommercialProposal(opp, await getProfile());
    res.json({ proposal, format: 'markdown' });
  } catch (e) {
    next(e);
  }
});

router.post('/email-reply', async (req, res, next) => {
  try {
    const suggestions = await suggestEmailReplies(req.body || {});
    res.json(suggestions);
  } catch (e) {
    next(e);
  }
});

router.post('/marketing-suggestions', async (req, res, next) => {
  try {
    const suggestions = await generateMarketingSuggestions(req.body?.stats || {});
    res.json({ suggestions });
  } catch (e) {
    next(e);
  }
});

export default router;
