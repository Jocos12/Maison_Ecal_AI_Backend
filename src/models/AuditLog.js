import mongoose from 'mongoose';

const AuditLogSchema = new mongoose.Schema(
  {
    action: {
      type: String,
      enum: ['create', 'update', 'delete', 'archive', 'status_change', 'application_sent'],
      required: true,
      index: true
    },
    entityType: {
      type: String,
      enum: ['contract', 'application', 'user'],
      required: true,
      index: true
    },
    entityId: { type: String, default: '' },
    entityLabel: { type: String, default: '', index: true },
    actorType: { type: String, enum: ['human', 'agent'], required: true, index: true },
    channel: { type: String, enum: ['ui', 'voice', 'text'], default: 'ui' },
    actorUserId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
    actorName: { type: String, default: '' },
    changes: [
      {
        field: { type: String, default: '' },
        from: { type: mongoose.Schema.Types.Mixed, default: null },
        to: { type: mongoose.Schema.Types.Mixed, default: null }
      }
    ]
  },
  { timestamps: true }
);

AuditLogSchema.index({ createdAt: -1 });

function refuse() {
  throw new Error('Le journal d’audit est en ajout seul.');
}

for (const hook of ['updateOne', 'updateMany', 'findOneAndUpdate', 'replaceOne', 'deleteOne', 'deleteMany', 'findOneAndDelete']) {
  AuditLogSchema.pre(hook, refuse);
}

export default mongoose.model('AuditLog', AuditLogSchema);
