import mongoose from 'mongoose';

const ApplicationSchema = new mongoose.Schema(
  {
    opportunity: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Opportunity',
      required: true
    },
    status: {
      type: String,
      enum: ['draft', 'submitted', 'pending', 'interview', 'won', 'rejected'],
      default: 'draft'
    },
    appliedDate: { type: Date },
    sentOn: { type: Date },
    sendMethod: { type: String, enum: ['email', 'portal', 'other'] },
    actualRecipientName: { type: String, default: '' },
    actualRecipientContact: { type: String, default: '' },
    companyReference: { type: String, default: '' },
    handledBy: { type: String, default: '' },
    followUps: [
      {
        date: { type: Date },
        note: { type: String, default: '' },
        createdAt: { type: Date, default: Date.now }
      }
    ],
    notes: { type: String },
    documents: [{ name: String, url: String, documentId: String, storageKey: String }],
    contactPerson: { name: String, email: String, phone: String },
    followUpDate: { type: Date },
    letterText: { type: String, default: '' },
    rejectionReason: { type: String, default: '' },
    sentEmail: {
      to: String,
      subject: String,
      body: String,
      attachmentName: String,
      gmailMessageId: String,
      sentAt: Date
    }
  },
  { timestamps: true }
);

export default mongoose.model('Application', ApplicationSchema);
