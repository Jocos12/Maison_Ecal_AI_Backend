import mongoose from 'mongoose';

const OpportunitySchema = new mongoose.Schema(
  {
    title: { type: String, required: true },
    description: { type: String },
    organization: { type: String },
    platform: {
      type: String,
      enum: [
        'ReliefWeb',
        'UNGM',
        'DevEx',
        'ProfilRDC',
        'AchatPublicRDC',
        'SIGMAP',
        'ARSP',
        'UNjobs',
        'HDX',
        'WorldBank',
        'AfDB',
        'GoogleCustomSearch',
        'Other'
      ],
      required: true
    },
    category: {
      type: String,
      enum: ['formation', 'formation_chauffeurs', 'consultance', 'inventaire', 'inventaire_actifs', 'inventaire_general', 'etude_marche', 'assistance'],
      required: true
    },
    location: { type: String },
    locationStatus: {
      type: String,
      enum: ['rdc_confirme', 'a_verifier', 'hors_rdc'],
      default: 'a_verifier',
      index: true
    },
    ville: {
      type: String,
      enum: ['Bukavu', 'Goma', 'Kinshasa', 'Kalemie', 'Lubumbashi', 'RDC', 'Non précisé'],
      default: 'Non précisé',
      index: true
    },
    deadline: { type: Date },
    postedDate: { type: Date },
    deadlineUnspecified: { type: Boolean, default: true },
    expiredReason: { type: String, default: '' },
    sourceUrl: { type: String, required: true, unique: true },
    fingerprint: { type: String, index: true, sparse: true, unique: true },
    firstSeenAt: { type: Date },
    isNew: { type: Boolean, default: true },
    isUrgent: { type: Boolean, default: false },
    isArchived: { type: Boolean, default: false },
    isRecommended: { type: Boolean, default: false, index: true },
    aiScoringProvider: { type: String, default: '' },
    rawKeywords: [{ type: String }],
    aiRelevanceScore: { type: Number, min: 0, max: 1 },
    aiAnalysis: {
      est_service: { type: Boolean, default: true },
      est_emploi: { type: Boolean, default: false },
      type: { type: String, enum: ['service', 'offre_emploi', 'autre'], default: 'service' },
      score: { type: Number, min: 0, max: 100 },
      categorie: { type: String },
      pays_confirme_rdc: { type: String, enum: ['true', 'false', 'a_verifier'], default: 'a_verifier' },
      justification: { type: String },
      recommandation: { type: String },
      raison: { type: String },
      ville_confirmee: { type: String },
      points_forts: [{ type: String }],
      action_suggeree: { type: String }
    },
    scrapedAt: { type: Date, default: Date.now },
    applyIntel: {
      analyzedAt: { type: Date },
      method: { type: String, enum: ['email', 'portal', 'pdf', 'unknown'], default: 'unknown' },
      emails: [{ type: String }],
      contactName: { type: String, default: '' },
      contactRole: { type: String, default: '' },
      portalUrl: { type: String, default: '' },
      portalHint: { type: String, default: '' },
      pdfLinks: [
        {
          url: { type: String, default: '' },
          label: { type: String, default: '' }
        }
      ],
      source: { type: String, enum: ['scraped_text', 'source_page_refetch', 'none'], default: 'none' },
      sourceLabel: { type: String, default: '' },
      confidence: { type: String, enum: ['confirmed', 'unconfirmed'], default: 'unconfirmed' },
      suggestedSubject: { type: String, default: '' },
      requiredDocuments: [{ type: String }],
      instructions: { type: String, default: '' },
      strategy: { type: String, default: '' },
      refetchError: { type: String, default: '' }
    },
    strictMecalMatch: {
      status: { type: String, enum: ['metier_confirme', 'hors_metier', 'a_verifier'] },
      statusLabel: { type: String },
      category: { type: String },
      categoryLabel: { type: String },
      justification: { type: String },
      provider: { type: String },
      classifiedAt: { type: Date }
    }
  },
  { timestamps: true, suppressReservedKeysWarning: true }
);

OpportunitySchema.index({ title: 'text', description: 'text', organization: 'text' });
OpportunitySchema.index({ firstSeenAt: -1 });
OpportunitySchema.index({ isArchived: 1, deadline: 1 });

export default mongoose.model('Opportunity', OpportunitySchema);
