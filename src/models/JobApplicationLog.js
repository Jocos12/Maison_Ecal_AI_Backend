import mongoose from 'mongoose';

const JobApplicationLogSchema = new mongoose.Schema(
  {
    userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    documentId: { type: mongoose.Schema.Types.ObjectId, ref: 'JobAssistantDocument' },
    jobTitle: { type: String, required: true },
    organization: { type: String, default: '' },
    sourceUrl: { type: String, default: '' },
    documentType: { type: String, enum: ['cv', 'letter'], default: 'cv' },
    documentFileName: { type: String, default: '' },
    recipientEmail: { type: String, default: '' },
    subject: { type: String, default: '' },
    submittedAt: { type: Date, default: Date.now },
    method: { type: String, enum: ['gmail', 'manual'], default: 'gmail' },
    gmailMessageId: { type: String, default: null }
  },
  { timestamps: true }
);

export default mongoose.model('JobApplicationLog', JobApplicationLogSchema);
