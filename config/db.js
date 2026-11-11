import mongoose from 'mongoose';
import { env } from './env.js';
import { logger } from '../utils/logger.js';

mongoose.set('strictQuery', true);

export async function connectDb(uri = env.MONGODB_URI) {
  mongoose.connection.on('error', (err) => logger.error('MongoDB connection error', { message: err.message }));
  mongoose.connection.on('disconnected', () => logger.warn('MongoDB disconnected'));
  await mongoose.connect(uri, { serverSelectionTimeoutMS: 15_000, maxPoolSize: 20 });
  logger.info('MongoDB connected', { db: mongoose.connection.name });
  return mongoose.connection;
}

export async function disconnectDb() {
  await mongoose.disconnect();
}
