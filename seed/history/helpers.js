// Small shared helpers for the demo-history generators. Everything here is pure and deterministic.
import { fromLocal, localParts } from '../../utils/dates.js';

export const MIN = 60_000;
export const HOUR = 3_600_000;
export const DAY = 86_400_000;

export const LOWER = 'abcdefghjkmnpqrstvwxyz23456789';
export const UPPER = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
export const DIGITS = '0123456789';
export const ALNUM = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';

/**
 * Ids that look like MongoDB ObjectIds (24 hex characters, time-ordered) but come from a counter, so the generators
 * stay pure and the same on every run. Mongoose casts these strings to real ObjectIds on insert.
 */
export function createIdFactory() {
  let counter = 0;
  return (date = new Date()) => {
    counter += 1;
    const seconds = Math.floor(date.getTime() / 1000).toString(16).padStart(8, '0');
    return `${seconds}d1a9e00000${counter.toString(16).padStart(6, '0')}`;
  };
}

/** The instant `minutes` after local midnight of a restaurant-local date key. */
export const localAt = (dateKeyValue, minutes) => new Date(fromLocal(dateKeyValue, '00:00').getTime() + minutes * MIN);

/** Minutes since local midnight for an instant. */
export function localMinutes(date) {
  const p = localParts(date);
  return p.hour * 60 + p.minute;
}

export const hmToMinutes = (hm) => {
  const [h, m] = String(hm).split(':').map(Number);
  return h * 60 + m;
};

export const clamp = (value, low, high) => Math.min(high, Math.max(low, value));
export const round3 = (value) => Math.round(value * 1000) / 1000;
export const addMinutes = (date, minutes) => new Date(date.getTime() + minutes * MIN);
export const actorOf = (user, role) => (user ? { id: user._id, name: user.name, role: role ?? user.role } : undefined);
