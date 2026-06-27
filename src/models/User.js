import mongoose from 'mongoose';

const OTP_TTL_MS = 10 * 60 * 1000;
const RESET_TTL_MS = 15 * 60 * 1000;

const UserSchema = new mongoose.Schema(
  {
    name: { type: String, required: true },
    email: { type: String, required: true, unique: true, lowercase: true, trim: true },
    password: { type: String, required: true },
    role: {
      type: String,
      enum: ['Analyste', 'Manager', 'Admin', 'admin', 'user'],
      default: 'Analyste'
    },
    isVerified: { type: Boolean, default: false },
    isApproved: { type: Boolean, default: false },
    lastLoginAt: { type: Date, default: null },
    otpHash: { type: String, default: null },
    otpExpiresAt: { type: Date, default: null },
    lastOtpSentAt: { type: Date, default: null },
    passwordResetKey: { type: String, default: null, index: true, sparse: true },
    passwordResetTokenHash: { type: String, default: null },
    passwordResetExpires: { type: Date, default: null },
    whatsappNumber: { type: String },
    digestEmail: { type: String },
    alertsEnabled: { type: Boolean, default: true },
    alertFrequency: {
      type: String,
      enum: ['immediate', 'daily', 'weekly'],
      default: 'daily'
    },
    keywords: [{ type: String }],
    preferredLanguage: { type: String, enum: ['en', 'fr', 'sw'], default: 'fr' },
    jobAssistantProfile: {
      fullName: { type: String, default: '' },
      email: { type: String, default: '' },
      phone: { type: String, default: '' },
      education: { type: String, default: '' },
      experience: { type: String, default: '' },
      skills: { type: String, default: '' },
      languages: { type: String, default: '' },
      cvFileName: { type: String, default: '' },
      cvFilePath: { type: String, default: '' },
      cvUploadedAt: { type: Date, default: null }
    }
  },
  { timestamps: true }
);

UserSchema.methods.assignOtp = function assignOtp(otpHash) {
  this.otpHash = otpHash;
  this.otpExpiresAt = new Date(Date.now() + OTP_TTL_MS);
  this.lastOtpSentAt = new Date();
};

UserSchema.methods.clearOtp = function clearOtp() {
  this.otpHash = null;
  this.otpExpiresAt = null;
};

UserSchema.methods.clearPasswordReset = function clearPasswordReset() {
  this.passwordResetKey = null;
  this.passwordResetTokenHash = null;
  this.passwordResetExpires = null;
};

UserSchema.methods.setPasswordReset = function setPasswordReset(key, tokenHash) {
  this.passwordResetKey = key;
  this.passwordResetTokenHash = tokenHash;
  this.passwordResetExpires = new Date(Date.now() + RESET_TTL_MS);
};

UserSchema.set('toJSON', {
  transform(_doc, ret) {
    delete ret.password;
    delete ret.otpHash;
    delete ret.passwordResetTokenHash;
    delete ret.passwordResetKey;
    delete ret.passwordResetExpires;
    return ret;
  }
});

export default mongoose.model('User', UserSchema);
