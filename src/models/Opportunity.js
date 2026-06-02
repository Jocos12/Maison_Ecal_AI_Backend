import mongoose from 'mongoose';

const OpportunitySchema = new mongoose.Schema(
  {
    title: { type: String, required: true },
    description: { type: String },
    organization: { type: String },
    platform: {
      type: String,
      enum: ['ReliefWeb', 'UNGM', 'DevEx', 'ProfilRDC', 'AchatPublicRDC', 'UNjobs', 'HDX', 'WorldBank', 'AfDB', 'GoogleCustomSearch', 'Other'],
      required: true
    },
    category: {
      type: String,
      enum: ['formation', 'formation_chauffeurs', 'consultance', 'inventaire', 'inventaire_actifs', 'inventaire_general', 'etude_marche', 'assistance'],
      required: true
    },
    location: { type: String },
    ville: {
      type: String,
      enum: ['Bukavu', 'Goma', 'Kinshasa', 'Kalemie', 'Lubumbashi', 'RDC', 'Non précisé'],
      default: 'Non précisé',
      index: true
    },
    deadline: { type: Date },
    postedDate: { type: Date },
    sourceUrl: { type: String, required: true, unique: true },
    isNew: { type: Boolean, default: true },
    isUrgent: { type: Boolean, default: false },
    isArchived: { type: Boolean, default: false },
    rawKeywords: [{ type: String }],
    aiRelevanceScore: { type: Number, min: 0, max: 1 },
    aiAnalysis: {
      est_service: { type: Boolean, default: true },
      est_emploi: { type: Boolean, default: false },
      score: { type: Number, min: 0, max: 100 },
      categorie: { type: String },
      recommandation: { type: String },
      raison: { type: String },
      ville_confirmee: { type: String },
      points_forts: [{ type: String }],
      action_suggeree: { type: String }
    },
    scrapedAt: { type: Date, default: Date.now }
  },
  { timestamps: true, suppressReservedKeysWarning: true }
);

OpportunitySchema.index({ title: 'text', description: 'text', organization: 'text' });

export default mongoose.model('Opportunity', OpportunitySchema);
