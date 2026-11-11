import rateLimit from 'express-rate-limit';
import { env } from '../config/env.js';

/**
 * Per-route rate limiter. Pass `keyGenerator` to limit by something other than the client IP
 * (for example IP + email on login so one shared proxy IP cannot lock everyone out).
 */
export function limiter({ windowMs = 60_000, limit = 60, keyGenerator, message } = {}) {
  return rateLimit({
    windowMs,
    limit,
    standardHeaders: 'draft-7',
    legacyHeaders: false,
    keyGenerator,
    skip: () => env.isTest,
    handler: (_req, res) => {
      res.status(429).json({
        ok: false,
        error: {
          code: 'RATE_LIMITED',
          message: message ?? 'Too many requests. Please wait a moment and try again.',
        },
      });
    },
  });
}
