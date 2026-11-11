// Tiny structured logger. Never log secrets, tokens, card data or full personal records.
import { env } from '../config/env.js';

const LEVELS = { debug: 10, info: 20, warn: 30, error: 40 };
const threshold = env.isTest ? LEVELS.error : env.isProd ? LEVELS.info : LEVELS.debug;

function write(level, message, meta) {
  if (LEVELS[level] < threshold) return;
  const line = { t: new Date().toISOString(), level, msg: message, ...(meta ? { meta } : {}) };
  const out = level === 'error' || level === 'warn' ? console.error : console.log;
  out(env.isProd ? JSON.stringify(line) : `[${level}] ${message}${meta ? ` ${JSON.stringify(meta)}` : ''}`);
}

export const logger = {
  debug: (m, meta) => write('debug', m, meta),
  info: (m, meta) => write('info', m, meta),
  warn: (m, meta) => write('warn', m, meta),
  error: (m, meta) => write('error', m, meta),
};
