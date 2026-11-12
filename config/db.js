import mongoose from 'mongoose';
import { env } from './env.js';
import { logger } from '../utils/logger.js';

mongoose.set('strictQuery', true);

/** The name ÉLAN gives its database when the connection string does not name one. */
export const DEFAULT_DB_NAME = 'elan';

/** The database named inside a MongoDB connection string, or '' when there is none (MongoDB would then use "test"). */
export function databaseNameOf(uri) {
  const match = /^mongodb(?:\+srv)?:\/\/[^/?]+\/([^?]*)/.exec(String(uri ?? ''));
  if (!match) return '';
  try {
    return decodeURIComponent(match[1]);
  } catch {
    return match[1];
  }
}

export async function connectDb(uri = env.MONGODB_URI) {
  mongoose.connection.on('error', (err) => logger.error('MongoDB connection error', { message: err.message }));
  mongoose.connection.on('disconnected', () => logger.warn('MongoDB disconnected'));
  const options = { serverSelectionTimeoutMS: 15_000, maxPoolSize: 20 };
  if (!databaseNameOf(uri)) {
    // A connection string with no database makes MongoDB use the shared default, "test", which often already holds
    // another project's collections and indexes. ÉLAN keeps to its own database instead.
    options.dbName = DEFAULT_DB_NAME;
    logger.info('MONGODB_URI names no database, so ÉLAN uses its own', { db: DEFAULT_DB_NAME });
  }
  await mongoose.connect(uri, options);
  logger.info('MongoDB connected', { db: mongoose.connection.name });
  return mongoose.connection;
}

export async function disconnectDb() {
  await mongoose.disconnect();
}
