import { env } from '../config/env.js';
import { ApiError } from '../utils/errors.js';

const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);
// Provider callbacks come from other servers and are authenticated by signature instead.
const EXEMPT_PREFIXES = ['/api/payments/webhook'];

export const CLIENT_HEADER = 'x-requested-with';
export const CLIENT_HEADER_VALUE = 'elan-web';

/**
 * CSRF defence for cookie sessions: state-changing requests must (a) come from an allowed origin when the
 * browser sends one, and (b) carry the custom X-Requested-With header, which cross-site forms cannot set.
 * Together with SameSite cookies this blocks cross-site request forgery without per-form tokens.
 */
export function originGuard(req, _res, next) {
  if (SAFE_METHODS.has(req.method)) return next();
  if (EXEMPT_PREFIXES.some((prefix) => req.originalUrl.startsWith(prefix))) return next();

  const origin = req.get('origin');
  if (origin && !env.allowedOrigins.includes(origin.replace(/\/+$/, ''))) {
    return next(new ApiError(403, 'BAD_ORIGIN', 'That request came from an origin we do not recognise.'));
  }
  if (req.get(CLIENT_HEADER) !== CLIENT_HEADER_VALUE) {
    return next(new ApiError(403, 'MISSING_CLIENT_HEADER', 'This endpoint can only be called from the ÉLAN website.'));
  }
  return next();
}
