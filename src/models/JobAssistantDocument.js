import mongoose from 'mongoose';

const JobAssistantDocumentSchema = new mongoose.Schema(
  {
    userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    documentType: { type: String, enum: ['cv', 'letter'], required: true },
    jobTitle: { type: String, required: true },
    organization: { type: String, default: '' },
    sourceUrl: { type: String, default: '' },
    city: { type: String, default: '' },
    textContent: { type: String, default: '' },
    filePath: { type: String, required: true },
    fileName: { type: String, required: true },
    status: { type: String, enum: ['generated', 'submitted'], default: 'generated' },
    confirmedForSend: { type: Boolean, default: false }
  },
  { timestamps: true }
);

export default mongoose.model('JobAssistantDocument', JobAssistantDocumentSchema);
