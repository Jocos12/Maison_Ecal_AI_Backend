import mongoose from 'mongoose';

const ApplicationSchema = new mongoose.Schema(
  {
    opportunity: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Opportunity',
      required: false
    },
    // Humanitarian notice (NRC, IRC, …) when the draft is not an RDC Opportunity.
    notice: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'NrcNotice'
    },
    externalOffer: {
      title: { type: String, default: '' },
      organization: { type: String, default: '' },
      url: { type: String, default: '' },
      ville: { type: String, default: '' },
      country: { type: String, default: '' },
      deadline: { type: Date },
      description: { type: String, default: '' },
      reference: { type: String, default: '' }
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
    },
    statusEvents: [
      {
        status: { type: String, required: true },
        at: { type: Date, required: true }
      }
    ],
    archivedAt: { type: Date, default: null }
  },
  { timestamps: true }
);

ApplicationSchema.index({ notice: 1 }, { unique: true, partialFilterExpression: { notice: { $type: 'objectId' } } });

export default mongoose.model('Application', ApplicationSchema);
