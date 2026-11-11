// Loyalty points: an append-only ledger (LoyaltyTransaction) plus a cached balance on the user.
// Every mutation is an atomic conditional update, so a balance can never go negative and a side effect never runs twice.
import { LoyaltyTransaction, Order, User } from '../models/index.js';
import { DEFAULT_TIERS } from '../models/constants.js';
import { conflict, notFound, unprocessable } from '../utils/errors.js';
import { getRestaurant } from './restaurantService.js';

// Ledger types that count towards the lifetime total (and therefore the tier). Refunds and adjustments do not.
const LIFETIME_TYPES = new Set(['earn', 'bonus', 'referral', 'birthday']);

/** Pure. The highest tier whose threshold the lifetime points reach. */
export function tierFor(lifetime, tiers = DEFAULT_TIERS) {
  const sorted = [...tiers].sort((a, b) => a.min - b.min);
  let current = sorted[0];
  for (const tier of sorted) if (lifetime >= tier.min) current = tier;
  return current;
}

/** Pure. floor(total x earnPerTaka x tier multiplier). */
export function pointsForTotal(total, earnPerTaka, tier) {
  return Math.max(0, Math.floor(total * earnPerTaka * (tier?.multiplier ?? 1)));
}

/** Adds (or removes, when negative) points with a ledger row. Returns { points, balance, tier }. */
export async function grantPoints({ userId, points, type = 'adjust', note, orderId, createdBy }) {
  const amount = Math.trunc(Number(points));
  if (!amount) throw unprocessable('Enter a number of points other than zero.');
  const restaurant = await getRestaurant();
  const inc = { 'loyalty.points': amount };
  if (amount > 0 && LIFETIME_TYPES.has(type)) inc['loyalty.lifetime'] = amount;
  const filter = { _id: userId };
  if (amount < 0) filter['loyalty.points'] = { $gte: -amount };
  const user = await User.findOneAndUpdate(filter, { $inc: inc }, { new: true }).select('loyalty');
  if (!user) {
    if (amount < 0 && (await User.exists({ _id: userId }))) throw conflict('That would take the balance below zero.', 'INSUFFICIENT_POINTS');
    throw notFound('Customer not found.');
  }
  const tier = tierFor(user.loyalty.lifetime, restaurant.loyalty.tiers);
  if (tier.key !== user.loyalty.tier) await User.updateOne({ _id: userId }, { $set: { 'loyalty.tier': tier.key } });
  await LoyaltyTransaction.create({ user: userId, type, points: amount, balanceAfter: user.loyalty.points, order: orderId, note, createdBy });
  return { points: amount, balance: user.loyalty.points, tier: tier.key };
}

/** Deducts points at checkout. Throws 409 INSUFFICIENT_POINTS when the balance is too low. */
export async function redeemPoints({ userId, points, orderId }) {
  const restaurant = await getRestaurant();
  const amount = Math.floor(Number(points));
  if (!(amount >= restaurant.loyalty.minRedeem)) throw unprocessable(`You can spend points from ${restaurant.loyalty.minRedeem} upwards.`);
  const user = await User.findOneAndUpdate({ _id: userId, 'loyalty.points': { $gte: amount } }, { $inc: { 'loyalty.points': -amount } }, { new: true }).select('loyalty');
  if (!user) throw conflict('You do not have enough points for that.', 'INSUFFICIENT_POINTS');
  await LoyaltyTransaction.create({ user: userId, type: 'redeem', points: -amount, balanceAfter: user.loyalty.points, order: orderId, note: 'Redeemed at checkout' });
  return { points: amount, value: Math.floor(amount * restaurant.loyalty.pointValue) };
}

/** Gives redeemed points back when an order is cancelled or rejected. Idempotent via order.loyaltyRefunded. */
export async function refundRedeemedPoints(order) {
  const points = order.loyaltyRedeemed?.points ?? 0;
  if (!order.user || points <= 0) return false;
  const flipped = await Order.findOneAndUpdate({ _id: order._id, loyaltyRefunded: false }, { $set: { loyaltyRefunded: true } });
  if (!flipped) return false;
  await grantPoints({ userId: order.user, points, type: 'refund', orderId: order._id, note: `Points returned for order ${order.orderNumber}` });
  return true;
}

/** The first delivered order of a referred guest rewards whoever referred them. Idempotent via User.referralRewarded. */
export async function maybeRewardReferral(order) {
  if (!order.user) return false;
  const restaurant = await getRestaurant();
  const referee = await User.findOneAndUpdate({ _id: order.user, referredBy: { $ne: null }, referralRewarded: false }, { $set: { referralRewarded: true } }, { new: true }).select('referredBy name');
  if (!referee?.referredBy) return false;
  await grantPoints({
    userId: referee.referredBy,
    points: restaurant.loyalty.referralBonus,
    type: 'referral',
    orderId: order._id,
    note: `Referral bonus: ${referee.name} placed their first order`,
  });
  return true;
}

/** Called when an order becomes delivered. Guest orders earn nothing. Idempotent via order.loyaltyAwarded. */
export async function awardForDeliveredOrder(order) {
  if (!order.user) return { points: 0 };
  const flipped = await Order.findOneAndUpdate({ _id: order._id, loyaltyAwarded: false }, { $set: { loyaltyAwarded: true } });
  if (!flipped) return { points: 0 };
  const restaurant = await getRestaurant();
  const user = await User.findById(order.user).select('loyalty').lean();
  if (!user) return { points: 0 };
  const tier = tierFor(user.loyalty?.lifetime ?? 0, restaurant.loyalty.tiers);
  const points = pointsForTotal(order.totals.total, restaurant.loyalty.earnPerTaka, tier);
  if (points > 0) await grantPoints({ userId: order.user, points, type: 'earn', orderId: order._id, note: `Order ${order.orderNumber}` });
  await maybeRewardReferral(order);
  return { points };
}

/** Data for GET /api/me/loyalty. */
export async function getLoyaltySummary(userId) {
  const [restaurant, user, history] = await Promise.all([
    getRestaurant(),
    User.findById(userId).select('loyalty referralCode').lean(),
    LoyaltyTransaction.find({ user: userId }).sort({ createdAt: -1 }).limit(30).lean(),
  ]);
  if (!user) throw notFound('Customer not found.');
  const tiers = [...restaurant.loyalty.tiers].sort((a, b) => a.min - b.min);
  const lifetime = user.loyalty?.lifetime ?? 0;
  const tier = tierFor(lifetime, tiers);
  const next = tiers.find((t) => t.min > lifetime) ?? null;
  const progress = next ? Math.min(1, (lifetime - tier.min) / (next.min - tier.min)) : 1;
  return {
    points: user.loyalty?.points ?? 0,
    lifetime,
    tier,
    nextTier: next,
    pointsToNext: next ? next.min - lifetime : 0,
    progress,
    tiers,
    rules: {
      earnPerTaka: restaurant.loyalty.earnPerTaka,
      pointValue: restaurant.loyalty.pointValue,
      minRedeem: restaurant.loyalty.minRedeem,
      signupBonus: restaurant.loyalty.signupBonus,
      referralBonus: restaurant.loyalty.referralBonus,
      birthdayBonus: restaurant.loyalty.birthdayBonus,
    },
    referralCode: user.referralCode ?? null,
    transactions: history.map((t) => ({ id: String(t._id), type: t.type, points: t.points, balanceAfter: t.balanceAfter, note: t.note, createdAt: t.createdAt })),
  };
}
