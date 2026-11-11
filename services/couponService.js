// Coupons: pure rule evaluation (unit tested) plus atomic redemption so limits cannot be exceeded by concurrent checkouts.
import mongoose from 'mongoose';
import { Coupon, Order } from '../models/index.js';
import { conflict } from '../utils/errors.js';
import { bdt } from '../utils/format.js';

/** Plain-language messages for each rejection reason. */
export function couponMessage(reason, coupon) {
  switch (reason) {
    case 'not_found':
      return 'That code does not exist. Check the spelling and try again.';
    case 'inactive':
      return 'That code is no longer active.';
    case 'not_started':
      return 'That code is not valid yet.';
    case 'expired':
      return 'That code has expired.';
    case 'exhausted':
      return 'That code has been fully claimed.';
    case 'user_limit':
      return 'You have already used that code the maximum number of times.';
    case 'min_order':
      return `Spend ${bdt(coupon?.minOrder)} or more on food to use this code.`;
    case 'first_order_only':
      return 'That code is for first orders only.';
    case 'signin_required':
      return 'Sign in to use this code.';
    case 'fulfillment': {
      const modes = (coupon?.appliesTo ?? []).map((m) => m.replace('_', '-')).join(' or ');
      return `That code only works for ${modes || 'other'} orders.`;
    }
    default:
      return 'That code cannot be used on this order.';
  }
}

const invalid = (reason, coupon) => ({ valid: false, reason, message: couponMessage(reason, coupon) });

/**
 * Pure. Decides whether `coupon` applies to a basket and how much it takes off.
 * ctx: { subtotal, deliveryFee, fulfillment, userUses, isFirstOrder, signedIn }
 */
export function evaluateCouponRules(coupon, ctx, now = new Date()) {
  if (!coupon) return invalid('not_found');
  if (!coupon.active) return invalid('inactive', coupon);
  if (coupon.startsAt && now < new Date(coupon.startsAt)) return invalid('not_started', coupon);
  if (coupon.expiresAt && now > new Date(coupon.expiresAt)) return invalid('expired', coupon);
  if (coupon.usageLimit != null && (coupon.usedCount ?? 0) >= coupon.usageLimit) return invalid('exhausted', coupon);
  if (coupon.appliesTo?.length && !coupon.appliesTo.includes(ctx.fulfillment)) return invalid('fulfillment', coupon);
  if (ctx.subtotal < (coupon.minOrder ?? 0)) return invalid('min_order', coupon);
  if (coupon.firstOrderOnly) {
    if (!ctx.signedIn) return invalid('signin_required', coupon);
    if (!ctx.isFirstOrder) return invalid('first_order_only', coupon);
  }
  if ((coupon.perUserLimit ?? 0) > 0 && (ctx.userUses ?? 0) >= coupon.perUserLimit) return invalid('user_limit', coupon);

  let discount = 0;
  let freeDelivery = false;
  if (coupon.type === 'percent') {
    discount = Math.round((ctx.subtotal * coupon.value) / 100);
    if (coupon.maxDiscount != null) discount = Math.min(discount, coupon.maxDiscount);
  } else if (coupon.type === 'fixed') {
    discount = Math.min(coupon.value, ctx.subtotal);
  } else if (coupon.type === 'free_delivery') {
    freeDelivery = true;
    discount = ctx.deliveryFee ?? 0;
  }
  discount = Math.max(0, Math.round(discount));
  return {
    valid: true,
    code: coupon.code,
    discount,
    freeDelivery,
    coupon: {
      id: String(coupon._id ?? ''),
      code: coupon.code,
      description: coupon.description,
      descriptionBn: coupon.descriptionBn,
      type: coupon.type,
      value: coupon.value,
    },
  };
}

/** Checks a coupon against a basket without consuming it. */
export async function evaluateCoupon(code, ctx) {
  const normalized = String(code ?? '').trim().toUpperCase();
  if (!normalized) return invalid('not_found');
  const coupon = await Coupon.findOne({ code: normalized }).lean();
  if (!coupon) return invalid('not_found');
  const userId = ctx.userId ?? null;
  let userUses = 0;
  let isFirstOrder = true;
  if (userId) {
    userUses = (coupon.redemptions ?? []).filter((r) => r.user && String(r.user) === String(userId)).length;
    if (coupon.firstOrderOnly) {
      const prior = await Order.countDocuments({ user: userId, status: { $nin: ['cancelled', 'rejected', 'pending_payment'] } });
      isFirstOrder = prior === 0;
    }
  }
  return evaluateCouponRules(coupon, { ...ctx, userUses, isFirstOrder, signedIn: Boolean(userId) });
}

/**
 * Consumes a coupon with one atomic conditional update: the usage and per-user limits are part of the filter,
 * so two checkouts racing for the last redemption cannot both win.
 */
export async function redeemCoupon({ couponId, userId, orderId }) {
  const and = [
    { _id: couponId, active: true },
    { $or: [{ usageLimit: null }, { $expr: { $lt: ['$usedCount', '$usageLimit'] } }] },
  ];
  if (userId) {
    const uid = new mongoose.Types.ObjectId(String(userId));
    and.push({
      $or: [
        { perUserLimit: null },
        { perUserLimit: { $lte: 0 } },
        {
          $expr: {
            $lt: [{ $size: { $filter: { input: '$redemptions', as: 'r', cond: { $eq: ['$$r.user', uid] } } } }, '$perUserLimit'],
          },
        },
      ],
    });
  }
  const updated = await Coupon.findOneAndUpdate(
    { $and: and },
    { $inc: { usedCount: 1 }, $push: { redemptions: { user: userId || undefined, order: orderId, at: new Date() } } },
    { new: true },
  );
  if (!updated) throw conflict('That code just reached its limit. Remove it to continue.', 'COUPON_UNAVAILABLE');
  return updated;
}

/** Undoes a redemption that never became an order (checkout failed half way). */
export async function rollbackRedemption({ couponId, orderId }) {
  await Coupon.updateOne({ _id: couponId, 'redemptions.order': orderId }, { $inc: { usedCount: -1 }, $pull: { redemptions: { order: orderId } } });
}

/** Releases the redemption of a cancelled / rejected / unpaid order. Safe to call twice (guarded by order.couponRecorded). */
export async function releaseCoupon(order) {
  const couponId = order.coupon?.couponId;
  if (!couponId) return false;
  const flipped = await Order.findOneAndUpdate({ _id: order._id, couponRecorded: true }, { $set: { couponRecorded: false } });
  if (!flipped) return false;
  await rollbackRedemption({ couponId, orderId: order._id });
  return true;
}
