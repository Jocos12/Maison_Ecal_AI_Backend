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
    skipReasons: { type: Map, of: Number, default: {} },
    skippedItems: {
      type: [
        {
          reasonKey: { type: String, default: '' },
          title: { type: String, default: '' },
          description: { type: String, default: '' },
          source: { type: String, default: '' },
          organization: { type: String, default: '' },
          platform: { type: String, default: '' },
          date: { type: Date },
          url: { type: String, default: '' },
          score: { type: Number, default: null }
        }
      ],
      default: []
    },
    triggeredBy: { type: String, default: 'cron' }
  },
  { timestamps: true }
);

export default mongoose.model('ScrapeLog', ScrapeLogSchema);
