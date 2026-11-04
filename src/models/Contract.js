import mongoose from 'mongoose';

const TYPES = ['appel_offres', 'emploi', 'prestation', 'consultance'];
const STATUSES = ['en_cours', 'gagne', 'termine', 'perdu', 'en_attente'];

const ContractSchema = new mongoose.Schema(
  {
    title: { type: String, required: true, trim: true },
    client: { type: String, required: true, trim: true },
    type: { type: String, enum: TYPES, required: true },
    status: { type: String, enum: STATUSES, default: 'en_attente' },
    amount: { type: Number, default: null },
    startDate: { type: Date, default: null },
    endDate: { type: Date, default: null },
    notes: { type: String, default: '' },
    ownerId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    ownerName: { type: String, default: '' },
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

export const CONTRACT_TYPES = TYPES;
export const CONTRACT_STATUSES = STATUSES;
export default mongoose.model('Contract', ContractSchema);
