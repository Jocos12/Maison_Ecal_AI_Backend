import mongoose from 'mongoose';

const ConversationMessageSchema = new mongoose.Schema(
  {
    role: { type: String, enum: ['user', 'assistant'], required: true },
    content: { type: String, required: true },
    timestamp: { type: Date, default: Date.now },
    jobs: { type: mongoose.Schema.Types.Mixed, default: null },
    document: { type: mongoose.Schema.Types.Mixed, default: null },
    provider: { type: String, default: null },
    suggestions: { type: [String], default: null },
    manualLinks: { type: mongoose.Schema.Types.Mixed, default: null },
    diagnosis: { type: String, default: null }
  },
  { _id: true }
);

const JobAssistantConversationSchema = new mongoose.Schema(
  {
    userId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
      index: true
    },
    title: { type: String, default: 'Nouvelle conversation' },
    messages: { type: [ConversationMessageSchema], default: [] },
    selectedOffer: { type: mongoose.Schema.Types.Mixed, default: null },
    pendingDocument: { type: mongoose.Schema.Types.Mixed, default: null }
  },
  { timestamps: true }
);

JobAssistantConversationSchema.index({ userId: 1, updatedAt: -1 });

export default mongoose.model('JobAssistantConversation', JobAssistantConversationSchema);
