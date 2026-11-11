// Recommendations from real behaviour: what sells, what a guest has ordered, and what is ordered together.
// Scoring is pure and explainable; there is no model and no hidden personalisation.
import { MenuItem, Order } from '../models/index.js';
import { serializeMenuItem } from '../serializers/menu.js';

const LIST_POPULATE = [
  { path: 'optionGroups', select: 'key isRequired minSelect active' },
  { path: 'category', select: 'name nameBn slug' },
];

const live = { archived: false, available: true };
const dto = (rows) => rows.map((r) => serializeMenuItem(r));

/** Pure. How often a guest ordered each category and dish. `orders` are lean orders with items[{ menuItem, categoryName, quantity }]. */
export function buildProfile(orders) {
  const categories = new Map();
  const items = new Map();
  for (const order of orders) {
    for (const line of order.items ?? []) {
      const qty = line.quantity ?? 1;
      if (line.categoryName) categories.set(line.categoryName, (categories.get(line.categoryName) ?? 0) + qty);
      if (line.menuItem) items.set(String(line.menuItem), (items.get(String(line.menuItem)) ?? 0) + qty);
    }
  }
  return { categories, items };
}

/**
 * Pure. Higher is better.
 * popularity (sales, featured, rating) + affinity (categories the guest orders from) - repetition (dishes they just had).
 */
export function scoreForYou(item, profile) {
  const popularity = Math.log1p(item.soldCount ?? 0) * 0.5 + (item.featured ? 1 : 0) + (item.rating?.avg ?? 0) / 5;
  const affinity = Math.min(profile.categories.get(item.category?.name) ?? 0, 6) * 0.35;
  const repeat = Math.min(profile.items.get(String(item._id)) ?? 0, 3) * 0.4;
  return popularity + affinity - repeat;
}

/** Pure. Merges lists of ids in priority order without duplicates. */
export function mergeUnique(lists, limit, exclude = []) {
  const seen = new Set(exclude.map(String));
  const out = [];
  for (const list of lists) {
    for (const id of list) {
      const key = String(id);
      if (seen.has(key)) continue;
      seen.add(key);
      out.push(key);
      if (out.length >= limit) return out;
    }
  }
  return out;
}

const PAIR_RULES = [
  [/starter|appeti|small/i, [/main|entr/i, /drink|beverage/i]],
  [/main|entr/i, [/dessert|sweet/i, /drink|beverage/i]],
  [/dessert|sweet/i, [/drink|beverage/i]],
  [/drink|beverage/i, [/dessert|sweet/i, /starter|appeti/i]],
  [/breakfast|brunch/i, [/drink|beverage/i, /dessert|sweet/i]],
];

/** Pure. Which kinds of dish go with a dish of this category. */
export function pairingCategories(categoryName = '') {
  return PAIR_RULES.find(([re]) => re.test(categoryName))?.[1] ?? [/dessert|sweet/i, /drink|beverage/i];
}

export async function popularItems(limit = 8) {
  const rows = await MenuItem.find(live).sort({ soldCount: -1, featured: -1, name: 1 }).limit(limit).populate(LIST_POPULATE).lean();
  return dto(rows);
}

export async function forYou(userId, limit = 8) {
  const orders = userId ? await Order.find({ user: userId, status: 'delivered' }).sort({ createdAt: -1 }).limit(30).select('items.menuItem items.categoryName items.quantity').lean() : [];
  if (orders.length === 0) return { items: await popularItems(limit), reason: 'popular' };
  const profile = buildProfile(orders);
  const rows = await MenuItem.find(live).populate(LIST_POPULATE).lean();
  const ranked = rows.map((r) => ({ r, score: scoreForYou(r, profile) })).sort((a, b) => b.score - a.score || a.r.name.localeCompare(b.r.name));
  return { items: dto(ranked.slice(0, limit).map((x) => x.r)), reason: 'history' };
}

/** What goes well with a dish: first what other guests ordered together, then the usual courses that follow. */
export async function pairingsFor(itemId, limit = 4) {
  const item = await MenuItem.findOne({ _id: itemId, archived: false }).populate('category', 'name').lean();
  if (!item) return null;

  const together = await Order.aggregate([
    { $match: { status: 'delivered', 'items.menuItem': item._id } },
    { $unwind: '$items' },
    { $match: { 'items.menuItem': { $ne: item._id } } },
    { $group: { _id: '$items.menuItem', n: { $sum: 1 } } },
    { $sort: { n: -1 } },
    { $limit: limit * 3 },
  ]);

  const pool = await MenuItem.find({ ...live, _id: { $ne: item._id } }).populate(LIST_POPULATE).lean();
  const byId = new Map(pool.map((p) => [String(p._id), p]));
  const bySales = [...pool].sort((a, b) => (b.soldCount ?? 0) - (a.soldCount ?? 0));
  const complementary = pairingCategories(item.category?.name).flatMap((re) => bySales.filter((p) => re.test(p.category?.name ?? '')).map((p) => p._id));

  const ids = mergeUnique([together.map((t) => t._id), complementary, bySales.map((p) => p._id)], limit, [item._id]).filter((id) => byId.has(id));
  return dto(ids.map((id) => byId.get(id)));
}
