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
    notes: { type: String },
    documents: [{ name: String, url: String }],
    contactPerson: { name: String, email: String, phone: String },
    followUpDate: { type: Date }
  },
  { timestamps: true }
);

export default mongoose.model('Application', ApplicationSchema);
