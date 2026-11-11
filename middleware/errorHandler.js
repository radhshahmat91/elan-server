import { ZodError } from 'zod';
import { ApiError } from '../utils/errors.js';
import { logger } from '../utils/logger.js';
import { env } from '../config/env.js';

export function notFoundHandler(req, res) {
  res.status(404).json({
    ok: false,
    error: { code: 'NOT_FOUND', message: `No route for ${req.method} ${req.path}.` },
  });
}

function send(res, status, code, message, details) {
  const error = { code, message };
  if (details) error.details = details;
  return res.status(status).json({ ok: false, error });
}

// Express error middleware must declare four parameters.
// eslint-disable-next-line no-unused-vars
export function errorHandler(err, req, res, _next) {
  if (res.headersSent) return undefined;

  if (err instanceof ApiError) return send(res, err.status, err.code, err.message, err.details);

  if (err instanceof ZodError) {
    const details = err.issues.map((i) => ({ path: i.path.join('.'), message: i.message }));
    return send(res, 422, 'VALIDATION_ERROR', 'Some details need fixing.', details);
  }

  // Mongoose / MongoDB
  if (err?.name === 'ValidationError' && err.errors) {
    const details = Object.values(err.errors).map((e) => ({ path: e.path, message: e.message }));
    return send(res, 422, 'VALIDATION_ERROR', 'Some details need fixing.', details);
  }
  if (err?.name === 'CastError') return send(res, 400, 'BAD_REQUEST', `Invalid value for ${err.path}.`);
  if (err?.code === 11000) {
    const field = Object.keys(err.keyPattern ?? {})[0] ?? 'value';
    return send(res, 409, 'DUPLICATE', `That ${field} is already in use.`);
  }

  // Body parser problems
  if (err?.type === 'entity.parse.failed') return send(res, 400, 'BAD_JSON', 'The request body is not valid JSON.');
  if (err?.type === 'entity.too.large') return send(res, 413, 'TOO_LARGE', 'The request body is too large.');
  if (err?.code === 'LIMIT_FILE_SIZE') return send(res, 413, 'TOO_LARGE', 'That file is too large.');

  logger.error('Unhandled error', { id: req.id, method: req.method, path: req.path, message: err?.message, stack: env.isProd ? undefined : err?.stack });
  return send(res, 500, 'INTERNAL', env.isProd ? 'Something went wrong on our side. Please try again.' : String(err?.message ?? err));
}
