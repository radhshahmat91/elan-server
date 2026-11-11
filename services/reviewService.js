// Reviews: only guests with a delivered order can review, one review per order and dish, moderated before they show.
import { MenuItem, Order, Review } from '../models/index.js';
import { firstName } from '../utils/format.js';

/** "Rahim Uddin" -> "Rahim U." so reviews show a name without exposing the full identity. */
export function displayName(name = '') {
  const parts = String(name).trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return 'Guest';
  return parts.length === 1 ? firstName(name) : `${parts[0]} ${parts[parts.length - 1][0].toUpperCase()}.`;
}

/** Recomputes the cached rating on a dish from its approved reviews. */
export async function recomputeItemRating(menuItemId) {
  if (!menuItemId) return;
  const [row] = await Review.aggregate([
    { $match: { menuItem: menuItemId, status: 'approved' } },
    { $group: { _id: '$menuItem', avg: { $avg: '$rating' }, count: { $sum: 1 } } },
  ]);
  await MenuItem.updateOne({ _id: menuItemId }, { $set: { 'rating.avg': row ? Math.round(row.avg * 10) / 10 : 0, 'rating.count': row?.count ?? 0 } });
}

export function serializeReview(r, { admin = false } = {}) {
  const o = typeof r.toObject === 'function' ? r.toObject() : r;
  const item = o.menuItem && typeof o.menuItem === 'object' && o.menuItem.name ? { id: String(o.menuItem._id), name: o.menuItem.name, nameBn: o.menuItem.nameBn || undefined, slug: o.menuItem.slug } : null;
  return {
    id: String(o._id),
    rating: o.rating,
    title: o.title || undefined,
    body: o.body,
    authorName: displayName(o.authorName),
    createdAt: o.createdAt,
    menuItem: item,
    verifiedPurchase: Boolean(o.verifiedPurchase),
    isDemo: Boolean(o.isDemo),
    reply: o.reply?.text ? { text: o.reply.text, by: o.reply.by, at: o.reply.at } : undefined,
    ...(admin ? { status: o.status, orderId: String(o.order), userId: String(o.user) } : {}),
  };
}

/**
 * What a guest can still review: every dish from a delivered order, and the visit itself.
 * Returns [{ orderId, orderNumber, deliveredAt, menuItem: {..}|null }].
 */
export async function reviewableFor(userId) {
  const orders = await Order.find({ user: userId, status: 'delivered' }).sort({ deliveredAt: -1 }).limit(20).lean();
  if (orders.length === 0) return [];
  const done = await Review.find({ user: userId, order: { $in: orders.map((o) => o._id) } }).select('order menuItem').lean();
  const key = (order, item) => `${order}:${item ?? 'visit'}`;
  const reviewed = new Set(done.map((r) => key(r.order, r.menuItem)));
  const out = [];
  for (const order of orders) {
    if (!reviewed.has(key(order._id, null))) out.push({ orderId: String(order._id), orderNumber: order.orderNumber, deliveredAt: order.deliveredAt, menuItem: null });
    const seen = new Set();
    for (const line of order.items) {
      if (!line.menuItem || seen.has(String(line.menuItem))) continue;
      seen.add(String(line.menuItem));
      if (reviewed.has(key(order._id, line.menuItem))) continue;
      out.push({
        orderId: String(order._id),
        orderNumber: order.orderNumber,
        deliveredAt: order.deliveredAt,
        menuItem: { id: String(line.menuItem), name: line.name, nameBn: line.nameBn || undefined, slug: line.slug, art: line.art?.motif ? { motif: line.art.motif, palette: line.art.palette, seed: line.art.seed } : undefined, image: line.image },
      });
    }
  }
  return out;
}
