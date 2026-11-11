// The demo history: about six weeks of orders, payments, loyalty points, stock movements, reviews, reservations, chats,
// notifications and an audit trail, all labelled isDemo so `--reset` removes exactly this and nothing else.
//
// planDemoHistory() is pure (no database), so it also powers `seed --dry-run` and the unit tests.
// seedDemoHistory() writes the plan; resetDemo() takes it out again.
import {
  Address, AuditLog, Cart, ContactMessage, Conversation, Coupon, LoyaltyTransaction, MenuItem, Message, Notification, Order, PasswordReset,
  Payment, Reservation, Review, Session, StockTransaction, Subscriber, User,
} from '../models/index.js';
import { getRestaurant } from '../services/restaurantService.js';
import { recomputeItemRating } from '../services/reviewService.js';
import { createRandom } from './random.js';
import { DEMO_CUSTOMERS } from './accounts.js';
import { generateOrders } from './history/orders.js';
import { buildStockLedger } from './history/stock.js';
import {
  generateAudit, generateCart, generateChats, generateContacts, generateNotifications, generateReservations, generateReviews, generateSubscribers,
} from './history/engagement.js';
import { createIdFactory } from './history/helpers.js';

export const DEMO_SEED = 20261104;

/**
 * Builds every demo document in memory.
 * @param {object} input
 * @param {Date} input.now
 * @param {object} input.restaurant
 * @param {object[]} input.menu          menu items with optionGroups and category populated
 * @param {object[]} input.tables
 * @param {Map<string, object>} input.coupons
 * @param {Record<string, object>} input.staff
 * @param {object[]} input.customers     user documents, each with `profile` (see accounts.js)
 * @param {object[]} input.ingredients
 * @param {Map<string, string>} input.supplierNames
 * @param {(date?: Date) => string} [input.nextId]
 */
export function planDemoHistory({ now, restaurant, menu, tables, coupons, staff, customers, ingredients, supplierNames, nextId = createIdFactory() }) {
  const rand = createRandom(DEMO_SEED);
  const orderSet = generateOrders({ now, rand, nextId, restaurant, menu, tables, coupons, staff, customers });
  const stock = buildStockLedger({ now, rand, ingredients, supplierNames, usage: orderSet.stockUsage, staff });
  const reservations = generateReservations({ now, rand, nextId, restaurant, tables, staff, customers });
  const { reviews, ratings } = generateReviews({ now, rand, nextId, orders: orderSet.orders, customers });
  const { conversations, messages } = generateChats({ now, nextId, customers, staff });
  const lowStock = ingredients.filter((i) => i.stock <= i.lowStockThreshold);
  const notifications = generateNotifications({ now, nextId, orders: orderSet.orders, reviews, reservations, customers, lowStock });
  const audit = generateAudit({ now, rand, nextId, staff, partialRefund: orderSet.partialRefund });
  const contacts = generateContacts({ now, rand, nextId });
  const subscribers = generateSubscribers({ now, rand, nextId });
  const cart = generateCart({ customers, menu, nextId, now });
  return { ...orderSet, stock, reservations, reviews, ratings, conversations, messages, notifications, audit, contacts, subscribers, cart };
}

/** A short, human summary of a plan, for the seed command and the test report. */
export function summarisePlan(plan) {
  const count = (list, pick) => list.reduce((m, item) => ((m[pick(item)] = (m[pick(item)] ?? 0) + 1), m), {});
  return {
    orders: plan.orders.length,
    ordersByStatus: count(plan.orders, (o) => o.status),
    payments: plan.payments.length,
    loyaltyEntries: plan.ledger.length,
    stockMovements: plan.stock.length,
    reservations: plan.reservations.length,
    reviews: plan.reviews.length,
    conversations: plan.conversations.length,
    notifications: plan.notifications.length,
    auditEntries: plan.audit.length,
    contactMessages: plan.contacts.length,
    subscribers: plan.subscribers.length,
  };
}

async function insertInChunks(Model, docs, size = 200) {
  for (let i = 0; i < docs.length; i += size) await Model.insertMany(docs.slice(i, i + size));
}

/**
 * Writes the demo history. `content` is the result of seedContent(), `accounts` of seedDemoAccounts().
 * Refuses to run twice: when demo orders already exist, it stops and says how to rebuild them.
 */
export async function seedDemoHistory({ now = new Date(), content, accounts, log = () => {} }) {
  if (await Order.exists({ isDemo: true })) {
    log('Demo history already exists. Run with --reset to rebuild it.');
    return { skipped: true };
  }

  const restaurant = await getRestaurant({ fresh: true });
  const { loadMenu } = await import('./content.js');
  const menu = await loadMenu();
  const customers = DEMO_CUSTOMERS.map((profile) => ({ ...accounts.customers.get(profile.key), profile }));
  const ingredients = [...content.ingredients.values()];
  const supplierNames = new Map([...content.suppliers.values()].map((s) => [String(s._id), s.name]));
  const staff = Object.fromEntries([...accounts.staff].map(([key, user]) => [key, user]));
  const plan = planDemoHistory({ now, restaurant, menu, tables: [...content.tables.values()], coupons: content.coupons, staff, customers, ingredients, supplierNames });

  // Orders and money first, then everything that points at them.
  await insertInChunks(Order, plan.orders);
  await insertInChunks(Payment, plan.payments);
  await insertInChunks(LoyaltyTransaction, plan.ledger);
  await User.bulkWrite(
    [...plan.wallets].map(([id, wallet]) => ({
      updateOne: { filter: { _id: id }, update: { $set: { 'loyalty.points': wallet.points, 'loyalty.lifetime': wallet.lifetime, 'loyalty.tier': wallet.tier, referralRewarded: wallet.referralRewarded } } },
    })),
  );
  for (const [code, uses] of plan.couponUse) {
    const coupon = content.coupons.get(code);
    if (coupon) await Coupon.updateOne({ _id: coupon._id }, { $inc: { usedCount: uses.length }, $push: { redemptions: { $each: uses } } });
  }
  await MenuItem.bulkWrite([
    ...[...plan.sold].map(([id, quantity]) => ({ updateOne: { filter: { _id: id }, update: { $inc: { soldCount: quantity } } } })),
    ...plan.ratings.map((r) => ({ updateOne: { filter: { _id: r.id, 'rating.count': 0 }, update: { $set: { 'rating.avg': r.avg, 'rating.count': r.count } } } })),
  ]);

  // The stock history replaces the one-line "Opening stock" entries, but only for ingredients nobody has touched yet.
  const touched = new Set((await StockTransaction.distinct('ingredient', { isDemo: { $ne: true }, $nor: [{ type: 'in', reason: 'Opening stock' }] })).map(String));
  const fresh = ingredients.filter((i) => !touched.has(String(i._id)));
  const freshIds = new Set(fresh.map((i) => String(i._id)));
  if (fresh.length) await StockTransaction.deleteMany({ ingredient: { $in: fresh.map((i) => i._id) }, type: 'in', reason: 'Opening stock', isDemo: { $ne: true } });
  await insertInChunks(StockTransaction, plan.stock.filter((row) => freshIds.has(String(row.ingredient))));

  await insertInChunks(Review, plan.reviews);
  await insertInChunks(Reservation, plan.reservations);
  await insertInChunks(Conversation, plan.conversations);
  await insertInChunks(Message, plan.messages);
  await insertInChunks(Notification, plan.notifications);
  await insertInChunks(AuditLog, plan.audit);
  await insertInChunks(ContactMessage, plan.contacts);
  await insertInChunks(Subscriber, plan.subscribers);
  if (plan.cart) await Cart.create(plan.cart);

  log(`Demo history added: ${plan.orders.length} orders, ${plan.reservations.length} reservations, ${plan.reviews.length} reviews, ${plan.stock.length} stock movements.`);
  return { skipped: false, plan, tables: content.tables, summary: summarisePlan(plan) };
}

/** Removes everything the demo seed created (and only that), including the demo accounts. */
export async function resetDemo({ log = () => {} } = {}) {
  const [users, orders, conversations] = await Promise.all([
    User.find({ isDemo: true }).select('_id').lean(),
    Order.find({ isDemo: true }).select('_id status items').lean(),
    Conversation.find({ isDemo: true }).select('_id').lean(),
  ]);
  const userIds = users.map((u) => u._id);
  const orderIds = orders.map((o) => o._id);
  const orderKeys = new Set(orderIds.map(String));

  // Counters that the demo orders and reviews fed: take their share back out.
  const soldBack = new Map();
  for (const order of orders) {
    if (order.status !== 'delivered') continue;
    for (const line of order.items) soldBack.set(String(line.menuItem), (soldBack.get(String(line.menuItem)) ?? 0) + line.quantity);
  }
  if (soldBack.size) await MenuItem.bulkWrite([...soldBack].map(([id, quantity]) => ({ updateOne: { filter: { _id: id }, update: { $inc: { soldCount: -quantity } } } })));
  const withRedemptions = await Coupon.find({ 'redemptions.order': { $in: orderIds } }).select('redemptions').lean();
  for (const coupon of withRedemptions) {
    const mine = coupon.redemptions.filter((r) => orderKeys.has(String(r.order))).length;
    await Coupon.updateOne({ _id: coupon._id }, { $inc: { usedCount: -mine }, $pull: { redemptions: { order: { $in: orderIds } } } });
  }
  const reviewedItems = await Review.distinct('menuItem', { isDemo: true, menuItem: { $ne: null } });

  const gone = {};
  const run = async (label, promise) => {
    const result = await promise;
    gone[label] = result.deletedCount ?? 0;
  };
  await run('payments', Payment.deleteMany({ order: { $in: orderIds } }));
  await run('orders', Order.deleteMany({ isDemo: true }));
  await run('loyalty', LoyaltyTransaction.deleteMany({ user: { $in: userIds } }));
  await run('reviews', Review.deleteMany({ isDemo: true }));
  await run('reservations', Reservation.deleteMany({ isDemo: true }));
  await run('messages', Message.deleteMany({ conversation: { $in: conversations.map((c) => c._id) } }));
  await run('conversations', Conversation.deleteMany({ isDemo: true }));
  await run('notifications', Notification.deleteMany({ $or: [{ isDemo: true }, { user: { $in: userIds } }] }));
  await run('audit', AuditLog.deleteMany({ isDemo: true }));
  await run('contacts', ContactMessage.deleteMany({ isDemo: true }));
  await run('subscribers', Subscriber.deleteMany({ isDemo: true }));
  await run('stock', StockTransaction.deleteMany({ isDemo: true }));
  await run('carts', Cart.deleteMany({ user: { $in: userIds } }));
  await run('addresses', Address.deleteMany({ user: { $in: userIds } }));
  await run('sessions', Session.deleteMany({ user: { $in: userIds } }));
  await run('resets', PasswordReset.deleteMany({ user: { $in: userIds } }));
  await run('users', User.deleteMany({ isDemo: true }));
  for (const id of reviewedItems) await recomputeItemRating(id);

  const total = Object.values(gone).reduce((sum, n) => sum + n, 0);
  log(total ? `Demo data removed (${total} documents).` : 'There was no demo data to remove.');
  return gone;
}
