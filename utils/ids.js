// Human-friendly identifiers. All use crypto randomness.
import crypto from 'node:crypto';

const LOWER = 'abcdefghjkmnpqrstvwxyz23456789'; // no look-alike characters
const UPPER = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const DIGITS = '0123456789';

function pick(alphabet, length) {
  const bytes = crypto.randomBytes(length);
  let out = '';
  for (let i = 0; i < length; i += 1) out += alphabet[bytes[i] % alphabet.length];
  return out;
}

/** Unguessable id used in public tracking and manage links. */
export const publicId = () => pick(LOWER, 14);

/** Readable order reference, e.g. EL-261104-4821. Uniqueness is enforced by an index; retry on collision. */
export function orderNumber(date = new Date()) {
  const yy = String(date.getUTCFullYear()).slice(2);
  const mm = String(date.getUTCMonth() + 1).padStart(2, '0');
  const dd = String(date.getUTCDate()).padStart(2, '0');
  return `EL-${yy}${mm}${dd}-${pick(DIGITS, 4)}`;
}

export const reservationCode = () => `RV-${pick(UPPER, 6)}`;
export const referralCode = () => `ELAN-${pick(UPPER, 6)}`;
export const sessionLabel = () => pick(LOWER, 8);

export function slugify(text) {
  return String(text)
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/&/g, ' and ')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80);
}
