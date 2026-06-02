import mongoose from 'mongoose';

const GmailTokenSchema = new mongoose.Schema(
  {
    userId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
      unique: true
    },
    userEmail: { type: String, required: true },
    accessToken: { type: String, required: true },
    refreshToken: { type: String },
    scope: { type: String },
    tokenType: { type: String },
    expiryDate: { type: Date },
    tokens: {
      access_token: String,
      refresh_token: String,
      scope: String,
      token_type: String,
      expiry_date: Number
    },
    connectedAt: { type: Date, default: Date.now }
  },
  { timestamps: true }
);

export default mongoose.model('GmailToken', GmailTokenSchema);
