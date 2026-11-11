import { randomUUID } from 'node:crypto';
import { logger } from '../utils/logger.js';

/** Adds a request id (also returned as X-Request-Id) and logs slow or failing requests. */
export function requestContext(req, res, next) {
  req.id = randomUUID();
  res.setHeader('X-Request-Id', req.id);
  const started = process.hrtime.bigint();
  res.on('finish', () => {
    const ms = Number(process.hrtime.bigint() - started) / 1e6;
    if (res.statusCode >= 500 || ms > 1500) {
      logger.warn('request', { id: req.id, method: req.method, path: req.path, status: res.statusCode, ms: Math.round(ms) });
    }
  });
  next();
}
