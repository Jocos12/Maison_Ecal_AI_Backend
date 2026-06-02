import mongoose from 'mongoose';
import logger from '../utils/logger.js';

export async function connectDb(uri) {
  if (typeof uri !== 'string' || !uri.trim()) {
    throw new Error(
      'MONGODB_URI is missing or invalid. Copy backend/.env.example to backend/.env and set MONGODB_URI (e.g. mongodb://127.0.0.1:27017/mecal_monitor or your Atlas URI).'
    );
  }
  mongoose.set('strictQuery', true);
  await mongoose.connect(uri.trim());
  logger.info('MongoDB connected');
}
