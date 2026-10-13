import mongoose from 'mongoose';

const CategorySettingSchema = new mongoose.Schema(
  {
    slug: { type: String, required: true, unique: true, index: true },
    enabled: { type: Boolean, default: true },
    description: { type: String, default: '' },
    extraKeywords: [{ type: String }],
    removedKeywords: [{ type: String }]
  },
  { timestamps: true }
);

export default mongoose.model('CategorySetting', CategorySettingSchema);
