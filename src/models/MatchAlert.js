import mongoose from 'mongoose';

const MatchAlertSchema = new mongoose.Schema(
  {
    opportunity: { type: mongoose.Schema.Types.ObjectId, ref: 'Opportunity', required: true, unique: true },
    title: { type: String, required: true },
    organization: { type: String, default: '' },
    matchReason: { type: String, default: '' },
    score: { type: Number, default: 0 },
    readAt: { type: Date, default: null }
  },
  { timestamps: true }
);

MatchAlertSchema.index({ readAt: 1, createdAt: -1 });

export default mongoose.model('MatchAlert', MatchAlertSchema);
