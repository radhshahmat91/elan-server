// The restaurant settings document: cached reads, open/closed state and the public DTO.
import { MenuItem, Restaurant } from '../models/index.js';
import { env } from '../config/env.js';
import { dateKey, localParts } from '../utils/dates.js';
import { serializeMenuItem } from '../serializers/menu.js';
import { restaurantData } from '../seed/data/restaurant.js';

let cache = { at: 0, doc: null };

/** Lean settings document. Created from the defaults the first time the API runs against an empty database. */
export async function getRestaurant({ fresh = false } = {}) {
  if (!fresh && cache.doc && Date.now() - cache.at < 5000) return cache.doc;
  let doc = await Restaurant.findOne({ key: 'main' }).lean();
  if (!doc) {
    await Restaurant.updateOne({ key: 'main' }, { $setOnInsert: restaurantData() }, { upsert: true });
    doc = await Restaurant.findOne({ key: 'main' }).lean();
  }
  cache = { at: Date.now(), doc };
  return doc;
}

export function invalidateRestaurantCache() {
  cache = { at: 0, doc: null };
}

const toMinutes = (hm) => {
  const [h, m] = String(hm).split(':').map(Number);
  return h * 60 + m;
};

/** Pure: is the restaurant open at `now`, and what are today's hours? Handles closing after midnight. */
export function computeOpenState(restaurant, now = new Date()) {
  const parts = localParts(now);
  const key = dateKey(now);
  const closedToday = (restaurant.closedDates ?? []).some((d) => d.date === key);
  const row = (restaurant.hours ?? []).find((h) => h.day === parts.weekday) ?? null;
  if (!row) return { openNow: false, todayHours: null };
  const todayHours = { open: row.open, close: row.close, closed: Boolean(row.closed || closedToday) };
  if (todayHours.closed) return { openNow: false, todayHours };
  const minutes = parts.hour * 60 + parts.minute;
  const open = toMinutes(row.open);
  const close = toMinutes(row.close);
  const overnight = close <= open;
  const openNow = overnight ? minutes >= open || minutes < close : minutes >= open && minutes < close;
  return { openNow, todayHours };
}

/** Public DTO for GET /api/restaurant. */
export async function publicRestaurant() {
  const doc = await getRestaurant();
  const { openNow, todayHours } = computeOpenState(doc);
  let chefsSpecialItem = null;
  if (doc.chefsSpecial) {
    const item = await MenuItem.findOne({ _id: doc.chefsSpecial, archived: false })
      .populate('optionGroups')
      .populate('category', 'name slug')
      .lean();
    if (item) chefsSpecialItem = serializeMenuItem(item);
  }
  // eslint-disable-next-line no-unused-vars
  const { _id, __v, key, createdAt, updatedAt, chefsSpecial, ...rest } = doc;
  return {
    ...rest,
    id: String(_id),
    tzOffsetMinutes: env.RESTAURANT_TZ_OFFSET_MINUTES,
    openNow,
    todayHours,
    chefsSpecialItem,
  };
}
