import Contract, { CONTRACT_STATUSES, CONTRACT_TYPES } from '../models/Contract.js';

const WON = ['gagne', 'termine'];
const DECIDED = ['gagne', 'termine', 'perdu'];

export function isAdmin(user) {
  return ['Admin', 'admin'].includes(user?.role);
}

export function buildContractQuery({ userId, owner = 'all', status, type, from, to } = {}) {
  const q = {};
  if (owner === 'me' && userId) q.ownerId = userId;
  if (status && CONTRACT_STATUSES.includes(status)) q.status = status;
  if (type && CONTRACT_TYPES.includes(type)) q.type = type;
  if (from || to) {
    q.startDate = {};
    if (from) q.startDate.$gte = new Date(from);
    if (to) {
      const end = new Date(to);
      end.setHours(23, 59, 59, 999);
      q.startDate.$lte = end;
    }
  }
  return q;
}

export async function listContracts(filters = {}) {
  return Contract.find(buildContractQuery(filters)).sort({ updatedAt: -1 }).lean();
}

export function summarizeContracts(rows = [], userId = null) {
  const mine = userId ? rows.filter((row) => String(row.ownerId) === String(userId)) : rows;
  const decided = rows.filter((row) => DECIDED.includes(row.status));
  const won = decided.filter((row) => WON.includes(row.status));
  const wonAmountMine = mine
    .filter((row) => WON.includes(row.status) && Number.isFinite(Number(row.amount)))
    .reduce((sum, row) => sum + Number(row.amount), 0);
  const byType = {};
  for (const row of rows) {
    if (!byType[row.type]) byType[row.type] = { total: 0, won: 0, decided: 0 };
    byType[row.type].total += 1;
    if (DECIDED.includes(row.status)) byType[row.type].decided += 1;
    if (WON.includes(row.status)) byType[row.type].won += 1;
  }
  return {
    total: rows.length,
    inProgress: rows.filter((row) => row.status === 'en_cours').length,
    waiting: rows.filter((row) => row.status === 'en_attente').length,
    wonAmountMine,
    successRate: decided.length ? Math.round((won.length / decided.length) * 100) : null,
    decided: decided.length,
    byType
  };
}

export async function contractStats(filters = {}) {
  const rows = await listContracts(filters);
  return summarizeContracts(rows, filters.userId);
}

function money(n) {
  return new Intl.NumberFormat('fr-FR', { maximumFractionDigits: 0 }).format(n || 0);
}

export function answerFromContracts(question, rows, userId) {
  const stats = summarizeContracts(rows, userId);
  const q = String(question || '').toLowerCase();
  const typeRates = Object.entries(stats.byType)
    .filter(([, v]) => v.decided > 0)
    .map(([type, v]) => ({ type, rate: Math.round((v.won / v.decided) * 100), decided: v.decided, won: v.won }))
    .sort((a, b) => b.rate - a.rate || b.decided - a.decided);

  if (/gagn|montant/.test(q)) {
    return `Vous avez gagné ${money(stats.wonAmountMine)} sur les contrats marqués gagnés ou terminés qui vous sont attribués (${stats.total} contrat(s) dans la sélection).`;
  }
  if (/taux|réuss|reuss|succes|succès/.test(q)) {
    if (stats.successRate == null) {
      return `Aucun contrat décidé dans cette sélection (${stats.total} au total), le taux de réussite n'est pas calculable.`;
    }
    return `Taux de réussite : ${stats.successRate} % (${stats.decided} contrat(s) décidé(s), hors « en cours » et « en attente »).`;
  }
  if (/conseil|concentr|priorit|sugg/.test(q)) {
    if (typeRates.length < 2) {
      return `Pas encore assez de contrats décidés pour un conseil par type. ${stats.total} contrat(s) enregistré(s), ${stats.inProgress} en cours.`;
    }
    const best = typeRates[0];
    const worst = typeRates[typeRates.length - 1];
    if (best.rate === worst.rate) {
      return `Les types décidés ont le même taux (${best.rate} %). Rien ne justifie encore de concentrer l'effort sur un seul type.`;
    }
    return `Les contrats « ${best.type} » réussissent à ${best.rate} % (${best.won}/${best.decided}), contre ${worst.rate} % pour « ${worst.type} ». Concentrez davantage l'effort sur ${best.type}.`;
  }
  if (/type|souvent|consultance|appel/.test(q)) {
    if (!typeRates.length) {
      return `Pas encore assez de contrats décidés pour comparer les types. ${stats.total} contrat(s) dans la sélection.`;
    }
    const best = typeRates[0];
    const lines = typeRates.map((item) => `${item.type} : ${item.rate} % (${item.won}/${item.decided})`).join(' ; ');
    return `Le type le plus souvent gagné ici est ${best.type} (${best.rate} %). Détail : ${lines}.`;
  }
  if (!stats.total) return 'Aucun contrat enregistré pour cette sélection.';
  const rate = stats.successRate == null ? 'non calculable' : `${stats.successRate} %`;
  return `${stats.total} contrat(s), ${stats.inProgress} en cours, ${stats.waiting} en attente. Montant gagné (vos contrats) : ${money(stats.wonAmountMine)}. Taux de réussite : ${rate}.`;
}
