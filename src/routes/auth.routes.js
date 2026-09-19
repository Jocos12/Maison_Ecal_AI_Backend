import { Router } from 'express';
import { authLimiter, passwordResetLimiter } from '../middleware/rateLimiter.js';
import { optionalAuthMiddleware, attachUser } from '../middleware/auth.js';
import * as auth from '../controllers/auth.controller.js';

const router = Router();

router.get('/me', optionalAuthMiddleware, attachUser, auth.getMe);
router.post('/signup', authLimiter, auth.signup);
router.post('/login', authLimiter, auth.login);
router.post('/verify-otp', authLimiter, auth.verifyOtp);
router.post('/resend-otp', authLimiter, auth.resendOtp);
router.post('/forgot-password', passwordResetLimiter, auth.forgotPassword);
router.post('/forgot-password/verify', passwordResetLimiter, auth.verifyResetOtp);
router.post('/reset-password', passwordResetLimiter, auth.resetPassword);
router.post('/logout', optionalAuthMiddleware, attachUser, auth.logout);

export default router;
