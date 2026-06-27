import mongoose from 'mongoose';

const LoginActivitySchema = new mongoose.Schema(
  {
    userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', index: true },
    email: { type: String, default: '' },
    name: { type: String, default: '' },
    role: { type: String, default: '' },
    action: {
      type: String,
      enum: ['login', 'logout', 'user_created', 'user_updated', 'user_deleted', 'user_approved', 'user_rejected'],
      default: 'login',
      index: true
    },
    targetUserId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
    targetEmail: { type: String, default: '' },
    details: { type: String, default: '' },
    ip: { type: String, default: '' },
    userAgent: { type: String, default: '' }
  },
  { timestamps: true }
);

LoginActivitySchema.index({ createdAt: -1 });

export default mongoose.model('LoginActivity', LoginActivitySchema);
