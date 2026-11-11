// Password hashing, opaque tokens and signed payloads built on node:crypto only.
import crypto from 'node:crypto';
import { promisify } from 'node:util';

const scrypt = promisify(crypto.scrypt);

// scrypt parameters (memory-hard). Stored inside each hash so they can be raised later.
const COST = { N: 2 ** 15, r: 8, p: 1, keylen: 64 };
const MAXMEM = 128 * 1024 * 1024;

export async function hashPassword(password) {
  const salt = crypto.randomBytes(16);
  const derived = await scrypt(String(password).normalize('NFKC'), salt, COST.keylen, {
    N: COST.N,
    r: COST.r,
    p: COST.p,
    maxmem: MAXMEM,
  });
  return ['scrypt', COST.N, COST.r, COST.p, salt.toString('base64url'), derived.toString('base64url')].join('$');
}

export async function verifyPassword(password, stored) {
  if (typeof stored !== 'string') return false;
  const [scheme, N, r, p, saltB64, hashB64] = stored.split('$');
  if (scheme !== 'scrypt' || !saltB64 || !hashB64) return false;
  const expected = Buffer.from(hashB64, 'base64url');
  const derived = await scrypt(String(password).normalize('NFKC'), Buffer.from(saltB64, 'base64url'), expected.length, {
    N: Number(N),
    r: Number(r),
    p: Number(p),
    maxmem: MAXMEM,
  });
  return derived.length === expected.length && crypto.timingSafeEqual(derived, expected);
}

export const sha256 = (value) => crypto.createHash('sha256').update(String(value)).digest('hex');

/** URL-safe random token (default 256 bits). */
export const randomToken = (bytes = 32) => crypto.randomBytes(bytes).toString('base64url');

export function hmacHex(secret, data) {
  return crypto.createHmac('sha256', secret).update(data).digest('hex');
}

/** Constant-time string comparison. */
export function safeEqual(a, b) {
  const left = Buffer.from(String(a));
  const right = Buffer.from(String(b));
  return left.length === right.length && crypto.timingSafeEqual(left, right);
}

const b64url = (input) => Buffer.from(input).toString('base64url');

/** Compact HS256-signed token: header.payload.signature (payload gets iat and exp). */
export function signToken(payload, secret, ttlSeconds = 600) {
  const now = Math.floor(Date.now() / 1000);
  const header = b64url(JSON.stringify({ alg: 'HS256', typ: 'ELAN' }));
  const body = b64url(JSON.stringify({ ...payload, iat: now, exp: now + ttlSeconds }));
  const signature = crypto.createHmac('sha256', secret).update(`${header}.${body}`).digest('base64url');
  return `${header}.${body}.${signature}`;
}

/** Returns the payload when the signature and expiry are valid, otherwise null. */
export function verifyToken(token, secret) {
  if (typeof token !== 'string') return null;
  const parts = token.split('.');
  if (parts.length !== 3) return null;
  const [header, body, signature] = parts;
  const expected = crypto.createHmac('sha256', secret).update(`${header}.${body}`).digest();
  const given = Buffer.from(signature, 'base64url');
  if (given.length !== expected.length || !crypto.timingSafeEqual(given, expected)) return null;
  try {
    const payload = JSON.parse(Buffer.from(body, 'base64url').toString('utf8'));
    if (!payload.exp || payload.exp < Math.floor(Date.now() / 1000)) return null;
    return payload;
  } catch {
    return null;
  }
}
