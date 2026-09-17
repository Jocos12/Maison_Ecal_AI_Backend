import mongoose from 'mongoose';

const OcrCacheSchema = new mongoose.Schema(
  {
    url: { type: String, required: true, unique: true, index: true },
    ocrText: { type: String, default: '' },
    provider: { type: String, default: '' },
    deadline: { type: Date, default: null },
    matchedPhrase: { type: String, default: '' },
    error: { type: String, default: '' }
  },
  { timestamps: true }
);

export default mongoose.model('OcrCache', OcrCacheSchema);
