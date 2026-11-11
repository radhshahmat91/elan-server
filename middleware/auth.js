// Session loading and authorisation guards. Always enforce access here (or in services),
// never only in the UI.
import { Session, User } from '../models/index.js';
import { randomToken, sha256 } from '../utils/crypto.js';
import { parseCookies, sessionCookieOptions } from '../utils/cookies.js';
import { forbidden, unauthorized } from '../utils/errors.js';
import { can } from '../utils/permissions.js';
import { env } from '../config/env.js';

const DAY_MS = 86_400_000;

/** Reads the session cookie. Sets req.user / req.session, or leaves them null. Never fails the request. */
export async function loadSession(req, _res, next) {
  req.user = null;
  req.session = null;
  try {
    const token = parseCookies(req.headers.cookie)[env.SESSION_COOKIE_NAME];
    if (!token || token.length > 128) return next();
    const session = await Session.findOne({ tokenHash: sha256(token), expiresAt: { $gt: new Date() } });
    if (!session) return next();
    const user = await User.findById(session.user);
    if (!user || user.status !== 'active') return next();
    req.session = session;
    req.user = user;
    if (Date.now() - (session.lastUsedAt?.getTime() ?? 0) > DAY_MS) {
      Session.updateOne({ _id: session._id }, { $set: { lastUsedAt: new Date() } }).catch(() => {});
    }
    return next();
  } catch (err) {
    return next(err);
  }
}

/**
 * Creates a session and sets the cookie. `remember` keeps it for SESSION_TTL_DAYS, otherwise the
 * cookie lasts for the browser session and the server-side session expires after one day.
 */
export async function startSession(req, res, user, { remember = false } = {}) {
  const token = randomToken(32);
  const ttlMs = remember ? env.SESSION_TTL_DAYS * DAY_MS : DAY_MS;
  const expiresAt = new Date(Date.now() + ttlMs);
  await Session.create({
    user: user._id,
    tokenHash: sha256(token),
    expiresAt,
    userAgent: String(req.get('user-agent') ?? '').slice(0, 300),
    ip: req.ip,
  });
  res.cookie(env.SESSION_COOKIE_NAME, token, sessionCookieOptions(req, remember ? expiresAt : undefined));
  return { expiresAt };
}

export async function endSession(req, res) {
  if (req.session) await Session.deleteOne({ _id: req.session._id });
  res.clearCookie(env.SESSION_COOKIE_NAME, { ...sessionCookieOptions(req), maxAge: undefined });
}

export function requireAuth(req, _res, next) {
  if (!req.user) return next(unauthorized());
  return next();
}

/** Allows any of the listed roles. */
export function requireRole(...roles) {
  return (req, _res, next) => {
    if (!req.user) return next(unauthorized());
    if (!roles.includes(req.user.role)) return next(forbidden());
    return next();
  };
}

/** Allows a user whose role grants at least one of the listed permissions (see utils/permissions.js). */
export function requirePermission(...permissions) {
  return (req, _res, next) => {
    if (!req.user) return next(unauthorized());
    if (!permissions.some((permission) => can(req.user.role, permission))) return next(forbidden());
    return next();
  };
}

/** The acting user in the shape stored in histories and audit logs. */
export function actorOf(req) {
  return req.user ? { id: req.user._id, name: req.user.name, role: req.user.role } : { name: 'Guest', role: 'guest' };
}
