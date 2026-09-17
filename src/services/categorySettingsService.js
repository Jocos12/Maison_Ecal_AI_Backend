import CategorySetting from '../models/CategorySetting.js';
import Opportunity from '../models/Opportunity.js';
import {
  MECAL_CATEGORY_KEYWORDS,
  getEffectiveMecalKeywords,
  setCategoryRuntimeOverlay
} from '../config/businessRules.js';
import { activeOpportunityFilter } from './opportunityLifecycle.js';

export const CATEGORY_META = [
  {
    slug: 'formation',
    label: 'Formations procédures logistiques',
    defaultDescription:
      'Prestations de firme : former des équipes aux procédures logistique, stocks, entrepôt ou supply chain. Pas un poste salarié de formateur isolé.'
  },
  {
    slug: 'formation_chauffeurs',
    label: 'Formation chauffeurs / conduite véhicules',
    defaultDescription:
      'Formation de chauffeurs, conduite défensive ou gestion de conducteurs de flotte, en prestation de firme.'
  },
  {
    slug: 'etude_marche',
    label: 'Étude de marchés',
    defaultDescription:
      'Étude ou analyse de marché liée à la logistique, la distribution ou la supply chain — pas l’agriculture, la finance ou la santé.'
  },
  {
    slug: 'inventaire_actifs',
    label: "Inventaire d'actifs d'une organisation",
    defaultDescription:
      'Mission d’inventaire des actifs / immobilisations d’une organisation (prestation, pas un emploi de magasinier).'
  },
  {
    slug: 'inventaire_general',
    label: "Inventaire général d'une organisation",
    defaultDescription:
      'Inventaire général ou physique d’une organisation : stocks, patrimoine, recensement logistique.'
  },
  {
    slug: 'consultance',
    label: 'Consultance, assistance et conseils',
    defaultDescription:
      'Conseil, assistance ou appui logistique (stocks, entrepôts, distribution, flotte, supply chain) pour une firme — pas un audit financier ni un achat de matériel seul.'
  }
];

function overlayFromDocs(docs) {
  const map = {};
  for (const row of docs) {
    map[row.slug] = {
      enabled: row.enabled !== false,
      description: row.description || '',
      extraKeywords: row.extraKeywords || [],
      removedKeywords: row.removedKeywords || []
    };
  }
  return map;
}

export async function refreshCategoryRuntime() {
  const docs = await CategorySetting.find().lean();
  setCategoryRuntimeOverlay(overlayFromDocs(docs));
}

export async function ensureCategorySettings() {
  for (const meta of CATEGORY_META) {
    await CategorySetting.updateOne(
      { slug: meta.slug },
      {
        $setOnInsert: {
          slug: meta.slug,
          enabled: true,
          description: meta.defaultDescription,
          extraKeywords: [],
          removedKeywords: []
        }
      },
      { upsert: true }
    );
  }
  await refreshCategoryRuntime();
}

export async function listCategoryDashboard() {
  await ensureCategorySettings();
  const [settings, stats] = await Promise.all([
    CategorySetting.find().lean(),
    Opportunity.aggregate([
      { $match: activeOpportunityFilter() },
      {
        $group: {
          _id: '$category',
          count: { $sum: 1 },
          lastFoundAt: { $max: { $ifNull: ['$firstSeenAt', '$createdAt'] } }
        }
      }
    ])
  ]);
  const bySlug = Object.fromEntries(settings.map((s) => [s.slug, s]));
  const statMap = Object.fromEntries(stats.map((s) => [s._id, s]));

  return CATEGORY_META.map((meta) => {
    const row = bySlug[meta.slug] || {};
    const st = statMap[meta.slug] || {};
    return {
      slug: meta.slug,
      label: meta.label,
      enabled: row.enabled !== false,
      description: row.description || meta.defaultDescription,
      defaultKeywords: MECAL_CATEGORY_KEYWORDS[meta.slug] || [],
      extraKeywords: row.extraKeywords || [],
      removedKeywords: row.removedKeywords || [],
      keywords: getEffectiveMecalKeywords(meta.slug),
      count: st.count || 0,
      lastFoundAt: st.lastFoundAt || null
    };
  });
}

export async function patchCategorySetting(slug, body = {}) {
  const meta = CATEGORY_META.find((c) => c.slug === slug);
  if (!meta) return null;

  const current =
    (await CategorySetting.findOne({ slug })) ||
    (await CategorySetting.create({
      slug,
      enabled: true,
      description: meta.defaultDescription,
      extraKeywords: [],
      removedKeywords: []
    }));

  const defaults = (MECAL_CATEGORY_KEYWORDS[slug] || []).map((k) => k.toLowerCase());
  let extra = [...(current.extraKeywords || [])];
  let removed = [...(current.removedKeywords || [])];

  if (typeof body.enabled === 'boolean') current.enabled = body.enabled;
  if (typeof body.description === 'string') current.description = body.description.slice(0, 800);

  const add = String(body.addKeyword || '').trim();
  if (add) {
    const key = add.slice(0, 80);
    removed = removed.filter((k) => k.toLowerCase() !== key.toLowerCase());
    if (!defaults.includes(key.toLowerCase()) && !extra.some((k) => k.toLowerCase() === key.toLowerCase())) {
      extra.push(key);
    }
  }

  const drop = String(body.removeKeyword || '').trim();
  if (drop) {
    extra = extra.filter((k) => k.toLowerCase() !== drop.toLowerCase());
    if (defaults.includes(drop.toLowerCase()) && !removed.some((k) => k.toLowerCase() === drop.toLowerCase())) {
      removed.push(drop);
    }
  }

  current.extraKeywords = extra;
  current.removedKeywords = removed;
  await current.save();
  await refreshCategoryRuntime();
  const all = await listCategoryDashboard();
  return all.find((c) => c.slug === slug);
}
