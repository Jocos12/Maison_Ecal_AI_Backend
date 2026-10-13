import mongoose from 'mongoose';

const ScanAlertSchema = new mongoose.Schema(
  {
    scrapeLog: { type: mongoose.Schema.Types.ObjectId, ref: 'ScrapeLog', required: true, unique: true },
    title: { type: String, required: true },
    message: { type: String, default: '' },
    kind: { type: String, default: 'pipeline' },
    triggeredBy: { type: String, default: '' },
    readAt: { type: Date, default: null }
  },
  { timestamps: true }
);

ScanAlertSchema.index({ readAt: 1, createdAt: -1 });

export default mongoose.model('ScanAlert', ScanAlertSchema);
