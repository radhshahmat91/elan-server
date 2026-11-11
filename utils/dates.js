// Restaurant-local date helpers. Dates travel as 'YYYY-MM-DD' keys and 'HH:mm' times in the
// restaurant's timezone (a fixed offset; Bangladesh has no daylight saving). Instants are real Dates.
import { env } from '../config/env.js';

const OFFSET_MS = env.RESTAURANT_TZ_OFFSET_MINUTES * 60_000;

export function isValidDateKey(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const [y, m, d] = value.split('-').map(Number);
  const probe = new Date(Date.UTC(y, m - 1, d));
  // Date.parse is lenient (it rolls 30 Feb into March), so round-trip the parts instead.
  return probe.getUTCFullYear() === y && probe.getUTCMonth() === m - 1 && probe.getUTCDate() === d;
}

export const isValidTime = (value) => typeof value === 'string' && /^([01]\d|2[0-3]):[0-5]\d$/.test(value);

/** Wall-clock parts of an instant in restaurant time. weekday: 0 = Sunday. */
export function localParts(date = new Date()) {
  const d = new Date(date.getTime() + OFFSET_MS);
  return {
    year: d.getUTCFullYear(),
    month: d.getUTCMonth() + 1,
    day: d.getUTCDate(),
    hour: d.getUTCHours(),
    minute: d.getUTCMinutes(),
    weekday: d.getUTCDay(),
  };
}

export function dateKey(date = new Date()) {
  const p = localParts(date);
  return `${p.year}-${String(p.month).padStart(2, '0')}-${String(p.day).padStart(2, '0')}`;
}

/** Converts restaurant-local 'YYYY-MM-DD' + 'HH:mm' into the real instant. */
export function fromLocal(dateKeyValue, hm = '00:00') {
  const [y, m, d] = dateKeyValue.split('-').map(Number);
  const [h, min] = hm.split(':').map(Number);
  return new Date(Date.UTC(y, m - 1, d, h, min) - OFFSET_MS);
}

export function weekdayOf(dateKeyValue) {
  const [y, m, d] = dateKeyValue.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d)).getUTCDay();
}

export function addDays(dateKeyValue, days) {
  const [y, m, d] = dateKeyValue.split('-').map(Number);
  const next = new Date(Date.UTC(y, m - 1, d + days));
  return `${next.getUTCFullYear()}-${String(next.getUTCMonth() + 1).padStart(2, '0')}-${String(next.getUTCDate()).padStart(2, '0')}`;
}

export function daysBetween(fromKey, toKey) {
  const [y1, m1, d1] = fromKey.split('-').map(Number);
  const [y2, m2, d2] = toKey.split('-').map(Number);
  return Math.round((Date.UTC(y2, m2 - 1, d2) - Date.UTC(y1, m1 - 1, d1)) / 86_400_000);
}

/** Start of the restaurant-local day containing the instant, as a real Date. */
export function startOfLocalDay(date = new Date()) {
  return fromLocal(dateKey(date), '00:00');
}
