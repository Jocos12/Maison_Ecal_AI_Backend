import { callAIForJSON } from './aiService.js';
import { getCategoryTeamNotes } from '../config/businessRules.js';

export const STRICT_MECAL_STATUSES = {
  metier_confirme: 'Métier confirmé',
  hors_metier: 'Hors métier',
  a_verifier: 'À vérifier manuellement'
};

export const STRICT_MECAL_CATEGORIES = {
  formation: 'Formations procédures logistiques',
  formation_chauffeurs: 'Formation chauffeurs / conduite véhicules',
  etude_marche: 'Étude de marchés logistique',
  inventaire_actifs: "Inventaire d'actifs",
  inventaire_general: "Inventaire général",
  consultance: 'Consultance, assistance et conseils logistiques'
};

const SYSTEM = `Tu es un analyste d'appels d'offres pour Maison ECAL (M-ECAL), firme de services logistiques en RDC.

Métiers ACCEPTÉS uniquement (prestation de firme, pas un emploi salarié) :
1. formation — formations aux procédures logistiques
2. formation_chauffeurs — formation chauffeurs / conduite défensive
3. etude_marche — étude de marché logistique ou commerciale liée à la supply chain
4. inventaire_actifs — inventaire d'actifs d'une organisation
5. inventaire_general — inventaire général / physique d'une organisation
6. consultance — consultance, assistance ou conseils en logistique, stocks, entrepôts, distribution, supply chain

EXCLUS (hors métier), même si la source est RDC ou le titre dit « consultance » :
- postes salariés (coordinator, officer, manager, recrutement d'une personne)
- audits financiers, audit de passation des marchés, juridique, assurance
- fournitures / achats de matériel, véhicules, équipements, sans volet conseil, formation ou inventaire
- VBG, santé, nutrition, Ebola, WASH, agriculture, reboisement, IT/logiciel, aménagement urbain, carbonisation
- rapports de situation, sitreps, bulletins humanitaires
- marchés hors RDC

Si le document n'est pas un marché auquel une firme peut candidater, c'est hors métier.
Si le contenu est trop court ou ambigu pour trancher, utilise a_verifier (pas metier_confirme).

JSON strict uniquement :
{"status":"metier_confirme"|"hors_metier"|"a_verifier","category":"formation"|"formation_chauffeurs"|"etude_marche"|"inventaire_actifs"|"inventaire_general"|"consultance"|null,"justification":"une phrase"}`;

function normalizeStatus(raw) {
  const s = String(raw || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '');
  if (s.includes('confirm')) return 'metier_confirme';
  if (s.includes('verif')) return 'a_verifier';
  return 'hors_metier';
}

function normalizeCategory(raw, status) {
  if (status !== 'metier_confirme') return null;
  const s = String(raw || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '');
  if (s.includes('chauffeur') || s.includes('conduite')) return 'formation_chauffeurs';
  if (s.includes('formation')) return 'formation';
  if (s.includes('marche') || s.includes('market')) return 'etude_marche';
  if (s.includes('actifs') || s.includes('asset')) return 'inventaire_actifs';
  if (s.includes('inventaire')) return 'inventaire_general';
  if (s.includes('consult') || s.includes('assistance') || s.includes('conseil')) return 'consultance';
  return null;
}

export function buildStrictMecalResult({ status, category, justification, provider }) {
  const st = normalizeStatus(status);
  let cat = normalizeCategory(category, st);
  if (st === 'metier_confirme' && !cat) {
    return {
      status: 'a_verifier',
      statusLabel: STRICT_MECAL_STATUSES.a_verifier,
      category: null,
      categoryLabel: null,
      justification: String(justification || 'Métier confirmé sans catégorie précise — à vérifier.').slice(0, 400),
      provider: provider || '',
      classifiedAt: new Date()
    };
  }
  return {
    status: st,
    statusLabel: STRICT_MECAL_STATUSES[st],
    category: cat,
    categoryLabel: cat ? STRICT_MECAL_CATEGORIES[cat] : null,
    justification: String(justification || '').slice(0, 400),
    provider: provider || '',
    classifiedAt: new Date()
  };
}

/**
 * Classification stricte M-ECAL via cascade IA (Claude → Gemini → Groq → OpenAI).
 * Indépendante de classifyMecalCategory() et du champ category.
 */
export async function classifyStrictMecalMatch(row = {}) {
  const prompt = `Titre: ${row.title || ''}
Organisation: ${row.organization || ''}
Plateforme: ${row.platform || ''}
Lieu: ${row.location || ''}
Description / extrait:
${String(row.description || '').slice(0, 3500)}

Classe cette offre pour Maison ECAL.`;

  const notes = getCategoryTeamNotes();
  const system = notes.length ? `${SYSTEM}\n\nPrécisions métier de l'équipe:\n${notes.join('\n')}` : SYSTEM;
  const { data, provider } = await callAIForJSON(prompt, system);
  return buildStrictMecalResult({
    status: data.status,
    category: data.category,
    justification: data.justification || data.raison,
    provider
  });
}
