import { Router } from 'express';
import bcrypt from 'bcryptjs';
import User from '../models/User.js';
import { authMiddleware, attachUser } from '../middleware/auth.js';
import { sendAccountApprovedEmail } from '../services/email.service.js';
import { getRecentActivity, recordAdminActivity } from '../services/loginActivityService.js';
import logger from '../utils/logger.js';

const router = Router();
const BCRYPT_ROUNDS = 12;
const ALLOWED_ROLES = ['Analyste', 'Manager', 'Admin'];

function isAdmin(user) {
  return user && ['Admin', 'admin'].includes(user.role);
}

function serializeUser(user) {
  if (!user) return null;
  const obj = user.toObject ? user.toObject() : user;
  delete obj.password;
  return { ...obj, id: obj._id?.toString() || obj.id };
}

router.use(authMiddleware);
router.use(attachUser);

router.use((req, res, next) => {
  if (!isAdmin(req.user)) {
    return res.status(403).json({ message: 'Accès réservé aux administrateurs.' });
  }
  next();
});

router.get('/activity/recent', async (req, res, next) => {
  try {
    const limit = Number(req.query.limit) || 20;
    const activity = await getRecentActivity(limit);
    res.json({ activity });
  } catch (e) {
    next(e);
  }
});

router.get('/users/pending', async (_req, res, next) => {
  try {
    const users = await User.find({ isApproved: false })
      .select('name email role createdAt isVerified lastLoginAt')
      .sort({ createdAt: -1 })
      .lean();
    res.json({ users });
  } catch (e) {
    next(e);
  }
});

router.get('/users', async (_req, res, next) => {
  try {
    const users = await User.find()
      .select('name email role createdAt isVerified isApproved lastLoginAt updatedAt')
      .sort({ createdAt: -1 })
      .limit(500)
      .lean();
    res.json({ users });
  } catch (e) {
    next(e);
  }
});

router.get('/users/:id', async (req, res, next) => {
  try {
    const user = await User.findById(req.params.id).select('-password');
    if (!user) return res.status(404).json({ message: 'Utilisateur introuvable.' });
    res.json({ user: serializeUser(user) });
  } catch (e) {
    next(e);
  }
});

router.post('/users', async (req, res, next) => {
  try {
    const { name, email, password, role, isApproved, isVerified } = req.body || {};
    if (!name || !email || !password) {
      return res.status(400).json({ message: 'Nom, e-mail et mot de passe requis.' });
    }
    if (password.length < 8) {
      return res.status(400).json({ message: 'Mot de passe : 8 caractères minimum.' });
    }

    const normalizedEmail = String(email).toLowerCase().trim();
    const exists = await User.findOne({ email: normalizedEmail });
    if (exists) {
      return res.status(409).json({ message: 'Cette adresse e-mail est déjà utilisée.' });
    }

    const hash = await bcrypt.hash(password, BCRYPT_ROUNDS);
    const user = await User.create({
      name: String(name).trim(),
      email: normalizedEmail,
      password: hash,
      role: ALLOWED_ROLES.includes(role) ? role : 'Analyste',
      isApproved: isApproved !== false,
      isVerified: isVerified !== false
    });

    await recordAdminActivity(req, req.user, {
      action: 'user_created',
      targetUser: user,
      details: `Création du compte ${user.email}`
    });

    res.status(201).json({ user: serializeUser(user), message: 'Utilisateur créé.' });
  } catch (e) {
    next(e);
  }
});

router.put('/users/:id', async (req, res, next) => {
  try {
    const user = await User.findById(req.params.id);
    if (!user) return res.status(404).json({ message: 'Utilisateur introuvable.' });

    const { name, email, role, isApproved, isVerified, password } = req.body || {};
    if (name !== undefined) user.name = String(name).trim();
    if (email !== undefined) {
      const normalizedEmail = String(email).toLowerCase().trim();
      const duplicate = await User.findOne({ email: normalizedEmail, _id: { $ne: user._id } });
      if (duplicate) {
        return res.status(409).json({ message: 'Cette adresse e-mail est déjà utilisée.' });
      }
      user.email = normalizedEmail;
    }
    if (role !== undefined && ALLOWED_ROLES.includes(role)) user.role = role;
    if (isApproved !== undefined) user.isApproved = Boolean(isApproved);
    if (isVerified !== undefined) user.isVerified = Boolean(isVerified);
    if (password) {
      if (password.length < 8) {
        return res.status(400).json({ message: 'Mot de passe : 8 caractères minimum.' });
      }
      user.password = await bcrypt.hash(password, BCRYPT_ROUNDS);
    }

    await user.save();

    await recordAdminActivity(req, req.user, {
      action: 'user_updated',
      targetUser: user,
      details: `Mise à jour du compte ${user.email}`
    });

    res.json({ user: serializeUser(user), message: 'Utilisateur mis à jour.' });
  } catch (e) {
    next(e);
  }
});

router.delete('/users/:id', async (req, res, next) => {
  try {
    if (String(req.params.id) === String(req.userId)) {
      return res.status(400).json({ message: 'Vous ne pouvez pas supprimer votre propre compte.' });
    }

    const user = await User.findById(req.params.id);
    if (!user) return res.status(404).json({ message: 'Utilisateur introuvable.' });

    if (['Admin', 'admin'].includes(user.role)) {
      const adminCount = await User.countDocuments({ role: { $in: ['Admin', 'admin'] } });
      if (adminCount <= 1) {
        return res.status(400).json({ message: 'Impossible de supprimer le dernier administrateur.' });
      }
    }

    await recordAdminActivity(req, req.user, {
      action: 'user_deleted',
      targetUser: user,
      details: `Suppression du compte ${user.email}`
    });

    await User.findByIdAndDelete(req.params.id);
    res.json({ message: 'Utilisateur supprimé.' });
  } catch (e) {
    next(e);
  }
});

router.patch('/users/:id/approve', async (req, res, next) => {
  try {
    const user = await User.findByIdAndUpdate(
      req.params.id,
      { $set: { isApproved: true, isVerified: true } },
      { new: true }
    ).select('-password');
    if (!user) return res.status(404).json({ message: 'Utilisateur introuvable.' });

    sendAccountApprovedEmail(user.email, user.name).catch((e) =>
      logger.warn(`Account approved email failed for ${user.email}: ${e.message}`)
    );

    await recordAdminActivity(req, req.user, {
      action: 'user_approved',
      targetUser: user,
      details: `Approbation du compte ${user.email}`
    });

    res.json({ user: serializeUser(user), message: 'Compte approuvé.' });
  } catch (e) {
    next(e);
  }
});

router.patch('/users/:id/reject', async (req, res, next) => {
  try {
    const user = await User.findById(req.params.id);
    if (!user) return res.status(404).json({ message: 'Utilisateur introuvable.' });
    if (['Admin', 'admin'].includes(user.role)) {
      return res.status(400).json({ message: 'Impossible de rejeter un administrateur.' });
    }

    await recordAdminActivity(req, req.user, {
      action: 'user_rejected',
      targetUser: user,
      details: `Rejet du compte ${user.email}`
    });

    await User.findByIdAndDelete(req.params.id);
    res.json({ message: 'Inscription rejetée et compte supprimé.' });
  } catch (e) {
    next(e);
  }
});

export default router;
