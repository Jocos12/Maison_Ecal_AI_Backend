import mongoose from 'mongoose';

const SourceSchema = new mongoose.Schema(
  {
    key: { type: String, required: true, unique: true },
    name: { type: String, required: true },
    url: { type: String, required: true },
    description: { type: String, default: '' },
    frequencyHours: { type: Number, default: 12 },
    enabled: { type: Boolean, default: true },
    scraperKey: { type: String, default: null },
    lastScrapedAt: { type: Date, default: null },
    lastStatus: { type: String, enum: ['idle', 'success', 'error'], default: 'idle' }
  },
  { timestamps: true }
);

export default mongoose.model('Source', SourceSchema);
