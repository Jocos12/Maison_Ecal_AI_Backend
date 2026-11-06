/**
 * Contrôle des rôles.
 *  - Admin   : tout, y compris la gestion des utilisateurs et le diagnostic IA.
 *  - Manager : peut modifier la configuration partagée (réglages, sources,
 *              catégories) et lancer les synchronisations.
 *  - Analyste / user : lecture et travail quotidien (opportunités, candidatures…).
 * Le rôle vient toujours de la base (req.user, chargé par attachUser), jamais du jeton.
 */

export function isAdmin(user) {
  return Boolean(user) && ['Admin', 'admin'].includes(user.role);
}

export function isManagerOrAdmin(user) {
  return isAdmin(user) || (Boolean(user) && user.role === 'Manager');
}

export function requireAdmin(req, res, next) {
  if (!isAdmin(req.user)) {
    return res.status(403).json({ message: 'Réservé aux administrateurs.' });
  }
  next();
}

export function requireManager(req, res, next) {
  if (!isManagerOrAdmin(req.user)) {
    return res.status(403).json({ message: 'Réservé aux managers et administrateurs.' });
  }
  next();
}
