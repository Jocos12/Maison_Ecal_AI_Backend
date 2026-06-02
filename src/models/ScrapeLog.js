import mongoose from 'mongoose';

const ScrapeLogSchema = new mongoose.Schema(
  {
    startedAt: { type: Date, default: Date.now },
    finishedAt: { type: Date },
    status: { type: String, enum: ['running', 'success', 'error'], default: 'running' },
    totalRaw: { type: Number, default: 0 },
    saved: { type: Number, default: 0 },
    skipped: { type: Number, default: 0 },
    byPlatform: { type: Map, of: Number, default: {} },
    message: { type: String, default: '' },
    triggeredBy: { type: String, default: 'cron' }
  },
  { timestamps: true }
);

export default mongoose.model('ScrapeLog', ScrapeLogSchema);
