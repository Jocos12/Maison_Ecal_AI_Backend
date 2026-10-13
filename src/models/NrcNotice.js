import mongoose from 'mongoose';

/**
 * A notice published by the Norwegian Refugee Council: a tender (nrc.no/procurement) or a job vacancy (NRC careers portal).
 * It lives in its own collection on purpose: it covers every country and includes job offers, whereas the M-ECAL
 * `Opportunity` pipeline (dashboard, alerts, analytics) is limited to services in the DRC.
 */
const NrcNoticeSchema = new mongoose.Schema(
  {
    kind: { type: String, enum: ['tender', 'job'], required: true, index: true },
    // "tender:<slug>" or "job:<requisition id>": stable across runs
    externalId: { type: String, required: true, unique: true },
    title: { type: String, required: true },
    url: { type: String, required: true },
    applyUrl: { type: String, default: '' },
    reference: { type: String, default: '' },
    // Tender: EoI, RFP, RFQ, ITB, Tender... Job: the NRC job category
    noticeType: { type: String, default: '' },

    country: { type: String, default: '', index: true },
    countryCode: { type: String, default: '', index: true },
    location: { type: String, default: '' },
    isDrc: { type: Boolean, default: false, index: true },

    postedDate: { type: Date },
    deadline: { type: Date },
    // Deadline as a number so that "closest deadline first" can put notices without one last
    sortDeadline: { type: Number, default: 9e15, index: true },

    description: { type: String, default: '' },
    docText: { type: String, default: '' },
    contactEmails: [{ type: String }],
    contactName: { type: String, default: '' },
    submissionSubject: { type: String, default: '' },
    documents: [
      {
        label: { type: String, default: '' },
        url: { type: String, default: '' },
        size: { type: String, default: '' }
      }
    ],
    jobInfo: {
      category: { type: String, default: '' },
      schedule: { type: String, default: '' },
      workplace: { type: String, default: '' },
      grade: { type: String, default: '' },
      level: { type: String, default: '' },
      contract: { type: String, default: '' }
    },
    detailFetchedAt: { type: Date, default: null },

    firstSeenAt: { type: Date, default: Date.now, index: true },
    lastSeenAt: { type: Date, default: Date.now },
    isNew: { type: Boolean, default: true },
    isArchived: { type: Boolean, default: false, index: true },
    archivedReason: { type: String, default: '' },

    // Only logistics notices are shown; `fitsMecal` marks the ones that match the services M-ECAL sells
    isLogistics: { type: Boolean, default: false, index: true },
    fitsMecal: { type: Boolean, default: false, index: true },
    classifiedAt: { type: Date, default: null },

    score: { type: Number, min: 0, max: 100, default: 0, index: true },
    scoreLabel: { type: String, enum: ['high', 'medium', 'low'], default: 'low' },
    scoreReason: { type: String, default: '' },
    scoreProvider: { type: String, default: '' },
    scoreFactors: [{ type: String }],
    matchedKeywords: [{ type: String }],
    scoredAt: { type: Date, default: null },

    brief: {
      summary: { type: String, default: '' },
      whatNrcAsks: [{ type: String }],
      requiredDocuments: [{ type: String }],
      requiredDocumentsGeneric: { type: Boolean, default: false },
      keyDates: [{ label: { type: String }, date: { type: Date }, note: { type: String } }],
      attentionPoints: [{ type: String }],
      fit: { type: String, default: '' },
      language: { type: String, default: '' },
      provider: { type: String, default: '' },
      generatedAt: { type: Date, default: null }
    },
    draft: {
      to: { type: String, default: '' },
      subject: { type: String, default: '' },
      body: { type: String, default: '' },
      language: { type: String, default: '' },
      tone: { type: String, default: '' },
      provider: { type: String, default: '' },
      generatedAt: { type: Date, default: null }
    }
  },
  { timestamps: true, suppressReservedKeysWarning: true }
);

NrcNoticeSchema.index({ title: 'text', country: 'text', reference: 'text' });

export default mongoose.model('NrcNotice', NrcNoticeSchema);
