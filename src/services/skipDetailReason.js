function blob(item = {}) {
  return `${item.title || ''} ${item.description || ''} ${item.organization || ''}`.toLowerCase();
}

const RULES = [
  {
    code: 'job',
    text: 'Poste salarié ou recrutement individuel, pas une prestation pour une firme',
    test: (t) =>
      /\b(coordinator|officer|manager|directeur|responsable|assistant|logisticien|recrutement d['’ ]?un|consultant individuel|freelance|développeur|developpeur|vacancy|job opening)\b/.test(
        t
      )
  },
  {
    code: 'audit',
    text: 'Audit financier ou audit de passation des marchés, sans prestation logistique',
    test: (t) => /\b(audit|passation des marches|passation de marches|commissaire aux comptes)\b/.test(t)
  },
  {
    code: 'vbg',
    text: 'Sujet VBG / protection, hors métiers logistiques M-ECAL',
    test: (t) => /\b(vbg|eas\/hs|genre|g pecuh)\b/.test(t) || t.includes('violence')
  },
  {
    code: 'health',
    text: 'Santé / épidémie / nutrition, hors périmètre logistique M-ECAL',
    test: (t) => /\b(ebola|sante|santé|vaccin|nutrition|hiv|paludisme|medical)\b/.test(t)
  },
  {
    code: 'agri',
    text: 'Agriculture ou financement agricole, hors supply chain logistique',
    test: (t) => /\b(agricol|agriculture|semence|elevage|élevage)\b/.test(t)
  },
  {
    code: 'goods',
    text: 'Fourniture / achat de matériel, sans volet conseil, formation ou inventaire',
    test: (t) =>
      /\b(equipement|équipement|fourniture|achat de|machine à laver|camping|parc de camions|vehicule|véhicule|hardware)\b/.test(
        t
      )
  },
  {
    code: 'it',
    text: 'Prestation IT / logiciel / linguistique, hors métiers M-ECAL',
    test: (t) => /\b(logiciel|software|developer|language technology|digital|informatique)\b/.test(t)
  },
  {
    code: 'travel',
    text: 'Agence de voyages ou organisation de déplacements, hors consultance logistique',
    test: (t) => /\b(agent de voyage|travel agent|billets d['’ ]avion|deplacements professionnels)\b/.test(t)
  },
  {
    code: 'sitrep',
    text: 'Bulletin, sitrep ou rapport — pas un appel d’offres auquel une firme peut candidater',
    test: (t) => /\b(sitrep|situation report|monitor|bulletin|flash update)\b/.test(t)
  }
];

export const SKIP_DETAIL_LABELS = Object.fromEntries(RULES.map((r) => [r.code, r.text]));

export function explainSkipDetail(item = {}) {
  const t = blob(item);
  const key = item.reasonKey || '';

  if (key === 'job_posting') {
    return { code: 'job', text: SKIP_DETAIL_LABELS.job };
  }
  if (key === 'not_a_tender') {
    return { code: 'sitrep', text: SKIP_DETAIL_LABELS.sitrep };
  }
  if (key === 'hors_rdc') {
    return { code: 'geo', text: 'Localisation hors RDC (pays ou région non éligible)' };
  }
  if (key === 'non_logistics') {
    const hit = RULES.find((r) => r.test(t));
    return hit || { code: 'non_logistics', text: 'Thématique hors logistique (travaux, EIES, achats hors conseil…)' };
  }

  const hit = RULES.find((r) => r.test(t));
  if (hit) return hit;

  if (key === 'not_mecal_service') {
    return {
      code: 'generic',
      text: 'Aucun des 6 métiers M-ECAL identifié dans le titre et la description (formation, chauffeurs, étude de marché, inventaire, consultance logistique)'
    };
  }

  return { code: 'generic', text: 'Filtrée hors périmètre de la veille M-ECAL' };
}
