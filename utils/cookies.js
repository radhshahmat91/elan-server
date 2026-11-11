import { env } from '../config/env.js';

/** Minimal Cookie header parser. Values are URI-decoded; malformed pairs are ignored. */
export function parseCookies(header = '') {
  const out = {};
  if (!header) return out;
  for (const part of header.split(';')) {
    const index = part.indexOf('=');
    if (index < 0) continue;
    const key = part.slice(0, index).trim();
    const value = part.slice(index + 1).trim();
    if (!key) continue;
    try {
      out[key] = decodeURIComponent(value);
    } catch {
      /* skip malformed value */
    }
  }
  return out;
}

export function isSecureRequest(req) {
  if (env.COOKIE_SECURE === 'true') return true;
  if (env.COOKIE_SECURE === 'false') return false;
  return Boolean(req.secure) || env.isProd;
}

/** Options for the session cookie. `expiresAt` makes it persistent ("remember me"). */
export function sessionCookieOptions(req, expiresAt) {
  const options = {
    httpOnly: true,
    secure: isSecureRequest(req),
    sameSite: env.COOKIE_SAMESITE,
    path: '/',
  };
  if (expiresAt) options.expires = expiresAt;
  return options;
}
