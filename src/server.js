import './loadEnv.js';
import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import { cookieParserMiddleware } from './middleware/cookieParse.js';
import { connectDb } from './config/db.js';
import { authMiddleware, attachUser } from './middleware/auth.js';
import { errorHandler } from './middleware/errorHandler.js';
import authPublicRoutes from './routes/auth.routes.js';
import authPrivateRoutes from './routes/auth.private.routes.js';
import opportunitiesRoutes from './routes/opportunities.js';
import applicationsRoutes from './routes/applications.js';
import statsRoutes from './routes/stats.js';
import sourcesRoutes from './routes/sources.js';
import analyticsRoutes from './routes/analytics.js';
import settingsRoutes from './routes/settings.js';
import agentRoutes from './routes/agent.js';
import aiRoutes, { handleAiDebug, handleAiStatus, handleAiTest } from './routes/ai.js';
import gmailRoutes from './routes/gmail.js';
import User from './models/User.js';
import bcrypt from 'bcryptjs';
import logger from './utils/logger.js';
import { startScraperJobs } from './jobs/scraperJob.js';
import { ensureDefaultSources } from './services/sourceService.js';
import { getGmailConfigDiagnostics, isGmailConfigured } from './config/gmail.js';

const gmailDiag = getGmailConfigDiagnostics();
logger.info('Gmail OAuth config', {
  configured: isGmailConfigured(),
  ...gmailDiag
});

const app = express();
app.use(cookieParserMiddleware);
app.use(helmet());
app.use(express.json({ limit: '1mb' }));

const origins = (process.env.CORS_ORIGINS || 'http://localhost:5173')
  .split(',')
  .map((s) => s.trim())
  .filter(Boolean);

app.use(
  cors({
    origin: origins,
    credentials: true
  })
);

app.get('/health', (_req, res) => res.json({ ok: true }));

app.get('/api/ai/debug', handleAiDebug);
app.get('/api/ai/status', handleAiStatus);
app.get('/api/ai/test', handleAiTest);

app.use('/api/auth', authPublicRoutes);
app.use('/api/auth', authPrivateRoutes);
app.use('/api/gmail', gmailRoutes);

const protectedApi = express.Router();
protectedApi.use(authMiddleware);
protectedApi.use(attachUser);
protectedApi.use('/opportunities', opportunitiesRoutes);
protectedApi.use('/applications', applicationsRoutes);
protectedApi.use('/stats', statsRoutes);
protectedApi.use('/sources', sourcesRoutes);
protectedApi.use('/analytics', analyticsRoutes);
protectedApi.use('/settings', settingsRoutes);
protectedApi.use('/agent', agentRoutes);
protectedApi.use('/ai', aiRoutes);

app.use('/api', protectedApi);

app.use(errorHandler);

async function bootstrapAdmin() {
  const count = await User.countDocuments();
  if (count > 0) return;
  const email = process.env.BOOTSTRAP_ADMIN_EMAIL;
  const password = process.env.BOOTSTRAP_ADMIN_PASSWORD;
  if (!email || !password) {
    logger.warn('No users and no BOOTSTRAP_ADMIN_* — use /api/auth/signup to create an account.');
    return;
  }
  const hash = await bcrypt.hash(password, 12);
  await User.create({
    name: 'Admin M-ECAL',
    email: email.toLowerCase(),
    password: hash,
    role: 'Admin',
    isVerified: true
  });
  logger.info(`Bootstrap admin created: ${email}`);
}

const PORT = process.env.PORT || 5000;

function resolveMongoUri() {
  const fromEnv = process.env.MONGODB_URI?.trim();
  if (fromEnv) return fromEnv;
  if (process.env.NODE_ENV !== 'production') {
    const fallback = 'mongodb://127.0.0.1:27017/mecal_monitor';
    logger.warn(`MONGODB_URI not set — using local dev default: ${fallback}`);
    return fallback;
  }
  return undefined;
}

async function main() {
  if (!process.env.JWT_SECRET || process.env.JWT_SECRET.length < 16) {
    logger.error('JWT_SECRET must be set (min 16 characters).');
    process.exit(1);
  }
  await connectDb(resolveMongoUri());
  await bootstrapAdmin();
  await ensureDefaultSources();
  startScraperJobs();
  app.listen(PORT, () => logger.info(`API listening on ${PORT}`));
}

main().catch((e) => {
  logger.error(e);
  process.exit(1);
});
