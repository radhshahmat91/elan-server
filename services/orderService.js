// Orders: creation (server-priced), the status lifecycle with who-may-do-what, and the side effects each status triggers.
import mongoose from 'mongoose';
import { Address, Cart, MenuItem, Order, Payment, Table, User } from '../models/index.js';
import { env } from '../config/env.js';
import { ApiError, conflict, forbidden, notFound, unprocessable } from '../utils/errors.js';
import { humanStatus } from '../utils/format.js';
import { orderNumber as makeOrderNumber, publicId as makePublicId } from '../utils/ids.js';
import { logger } from '../utils/logger.js';
import { buildQuote } from './pricingService.js';
import { redeemCoupon, releaseCoupon, rollbackRedemption } from './couponService.js';
import { awardForDeliveredOrder, grantPoints, redeemPoints, refundRedeemedPoints } from './loyaltyService.js';
import { deductStockForOrder } from './inventoryService.js';
import { cancelPendingPayment, initiatePayment, refundPayment } from './paymentService.js';
import { announcePlaced, emitOrderUpdate, notifyCustomer } from './orderEvents.js';
import { notifyUser } from './notificationService.js';
import { getRestaurant } from './restaurantService.js';
import { serializeOrder } from '../serializers/order.js';

export { serializeOrder };

/** Allowed transitions: status -> statuses reachable next. */
export const STATUS_FLOW = {
  pending_payment: ['placed', 'cancelled'],
  placed: ['confirmed', 'rejected', 'cancelled'],
  confirmed: ['preparing', 'cancelled'],
  preparing: ['ready', 'cancelled'],
  ready: ['out_for_delivery', 'delivered', 'cancelled'], // out_for_delivery only for delivery orders
  out_for_delivery: ['delivered'],
  delivered: [],
  cancelled: [],
  rejected: [],
};

export const SYSTEM = Object.freeze({ name: 'System', role: 'system' });
const TIME_FIELD = { placed: 'placedAt', confirmed: 'confirmedAt', preparing: 'preparingAt', ready: 'readyAt', delivered: 'deliveredAt' };
const CHEF_MOVES = new Set(['placed>confirmed', 'placed>rejected', 'confirmed>preparing', 'preparing>ready']);

const deny = (status, code, reason) => ({ ok: false, status, code, reason });
const allow = () => ({ ok: true });
const sameId = (a, b) => a != null && b != null && String(a) === String(b);

/**
 * Pure. May `actor` move `order` to `toStatus`?
 * Returns { ok: true } or { ok: false, status, code, reason }.
 *   owner / manager  any valid transition      chef  placed>confirmed|rejected, confirmed>preparing, preparing>ready, ready>delivered (pickup, dine-in hand-over)
 *   delivery         ready>out_for_delivery (delivery orders, unassigned or theirs), out_for_delivery>delivered (theirs)
 *   customer / guest cancel their own order while it is pending_payment or placed      system  anything valid
 */
export function canTransition(order, toStatus, actor) {
  const from = order.status;
  if (!(toStatus in STATUS_FLOW)) return deny(409, 'UNKNOWN_STATUS', 'That is not an order status.');
  if (!STATUS_FLOW[from]?.includes(toStatus)) {
    return deny(409, 'INVALID_TRANSITION', `An order that is ${humanStatus(from)} cannot become ${humanStatus(toStatus)}.`);
  }
  const isDelivery = order.fulfillment === 'delivery';
  if (toStatus === 'out_for_delivery' && !isDelivery) return deny(409, 'INVALID_TRANSITION', 'Only delivery orders go out for delivery.');
  if (from === 'ready' && toStatus === 'delivered' && isDelivery) return deny(409, 'INVALID_TRANSITION', 'A delivery order must go out with a rider before it is delivered.');

  const role = actor?.role;
  if (role === 'system' || role === 'owner' || role === 'manager') return allow();

  if (role === 'chef') {
    const move = `${from}>${toStatus}`;
    if (CHEF_MOVES.has(move)) return allow();
    if (move === 'ready>delivered' && !isDelivery) return allow();
    return deny(403, 'FORBIDDEN', 'The kitchen can confirm, start, and finish orders.');
  }
  if (role === 'delivery') {
    if (from === 'ready' && toStatus === 'out_for_delivery') {
      if (order.assignedDelivery && !sameId(order.assignedDelivery, actor.id)) return deny(409, 'ASSIGNED_ELSEWHERE', 'That delivery is assigned to another rider.');
      return allow();
    }
    if (from === 'out_for_delivery' && toStatus === 'delivered') {
      return sameId(order.assignedDelivery, actor.id) ? allow() : deny(403, 'FORBIDDEN', 'Only the assigned rider can complete this delivery.');
    }
    return deny(403, 'FORBIDDEN', 'Riders can pick up and complete deliveries.');
  }
  if (role === 'customer' || role === 'guest') {
    const owns = role === 'customer' ? sameId(order.user, actor.id) : !order.user;
    if (!owns) return deny(403, 'FORBIDDEN', 'You can only change your own orders.');
    if (toStatus === 'cancelled' && (from === 'placed' || from === 'pending_payment')) return allow();
    return deny(409, 'CANNOT_CANCEL', 'This order is already being prepared and can no longer be cancelled online. Please call the restaurant.');
  }
  return deny(403, 'FORBIDDEN', 'You do not have permission to do that.');
}

// ---------------------------------------------------------------------------------------------------
// Creating an order
// ---------------------------------------------------------------------------------------------------

async function resolveAddress(input, user, customerName) {
  if (input.addressId && user) {
    const saved = await Address.findOne({ _id: input.addressId, user: user._id }).lean();
    if (saved) return { label: saved.label, recipient: saved.recipient || customerName, line1: saved.line1, area: saved.area, city: saved.city, notes: saved.notes };
  }
  const a = input.address;
  if (!a?.line1 || !a?.area) return null;
  return { label: a.label || 'Delivery', recipient: a.recipient || customerName, line1: a.line1, area: a.area, city: a.city || 'Dhaka', notes: a.notes };
}

async function insertOrder(doc) {
  for (let attempt = 0; attempt < 6; attempt += 1) {
    try {
      return await Order.create({ ...doc, orderNumber: makeOrderNumber(), publicId: makePublicId() });
    } catch (err) {
      const duplicateNumber = err?.code === 11000 && (err.keyPattern?.orderNumber || err.keyPattern?.publicId);
      if (!duplicateNumber || attempt === 5) throw err;
    }
  }
  return null;
}

const paymentInfo = (session) => (session ? { sessionId: session.sessionId, redirectUrl: session.redirectUrl, expiresAt: session.expiresAt } : null);

/**
 * Validates, re-prices on the server, redeems coupon and points, creates the order and (for online methods) the payment session.
 * input is already shape-validated by the route. Returns { order, payment, replayed? }.
 */
export async function createOrder({ input, user = null }) {
  const restaurant = await getRestaurant();
  const userId = user?._id ? String(user._id) : null;

  if (input.idempotencyKey) {
    const existing = await Order.findOne({ idempotencyKey: input.idempotencyKey });
    if (existing) {
      if (!sameId(existing.user, userId)) throw conflict('That request key was already used for another order.', 'IDEMPOTENCY_CONFLICT');
      const latest = existing.payment?.paymentId ? await Payment.findById(existing.payment.paymentId).lean() : null;
      const session = latest?.status === 'pending' && latest.sessionExpiresAt > new Date() ? { sessionId: latest.sessionId, redirectUrl: `${env.PUBLIC_CLIENT_URL}/payment/sandbox?session=${latest.sessionId}`, expiresAt: latest.sessionExpiresAt } : null;
      return { order: existing, payment: session, replayed: true };
    }
  }

  const fulfillment = input.fulfillment;
  const customer = {
    name: input.customer?.name || user?.name,
    phone: input.customer?.phone || user?.phone,
    email: (input.customer?.email || user?.email || '').toLowerCase() || undefined,
  };
  if (!customer.name || !customer.phone) {
    throw unprocessable('Add a name and phone number so we can reach you about your order.', [
      ...(!customer.name ? [{ path: 'customer.name', message: 'Enter your name' }] : []),
      ...(!customer.phone ? [{ path: 'customer.phone', message: 'Enter a phone number' }] : []),
    ]);
  }

  let address;
  let tableNumber;
  let source = 'web';
  if (fulfillment === 'delivery') {
    address = await resolveAddress(input, user, customer.name);
    if (!address) throw unprocessable('Add a delivery address.', [{ path: 'address.line1', message: 'Enter your street address and area' }]);
    const served = restaurant.delivery.areas ?? [];
    if (served.length && !served.some((a) => a.toLowerCase() === address.area.toLowerCase())) {
      throw new ApiError(422, 'AREA_NOT_SERVED', `We do not deliver to ${address.area} yet. We currently deliver to ${served.join(', ')}.`, [{ path: 'address.area', message: 'Choose one of our delivery areas' }]);
    }
  } else if (fulfillment === 'dine_in') {
    const table = await Table.findOne({ number: String(input.tableNumber ?? ''), active: true }).lean();
    if (!table) throw unprocessable('We could not find that table. Scan the QR code on your table again.');
    if (!table.qrToken || input.tableToken !== table.qrToken) throw forbidden('That table link is not valid. Scan the QR code on your table again.', 'BAD_TABLE_TOKEN');
    tableNumber = table.number;
    source = 'qr';
  }

  let scheduledFor = null;
  if (input.scheduledFor) {
    scheduledFor = new Date(input.scheduledFor);
    const lead = scheduledFor.getTime() - Date.now();
    if (Number.isNaN(scheduledFor.getTime()) || lead < 30 * 60_000 || lead > 7 * 86_400_000) {
      throw unprocessable('Choose a time at least 30 minutes from now and within the next 7 days.', [{ path: 'scheduledFor', message: 'Pick a time between 30 minutes and 7 days from now' }]);
    }
  }

  const quote = await buildQuote(
    { items: input.items, fulfillment, couponCode: input.couponCode, loyaltyPoints: input.loyaltyPoints },
    { userId },
  );
  if (!quote.ok) throw new ApiError(409, 'CART_INVALID', quote.issues[0]?.message ?? 'Your cart needs attention before you can order.', { issues: quote.issues });

  const orderId = new mongoose.Types.ObjectId();
  const online = input.paymentMethod !== 'cod';
  let couponTaken = false;
  let pointsTaken = 0;
  try {
    if (quote.coupon?.couponId) {
      await redeemCoupon({ couponId: quote.coupon.couponId, userId, orderId });
      couponTaken = true;
    }
    if (quote.loyalty?.points) {
      const redeemed = await redeemPoints({ userId, points: quote.loyalty.points, orderId });
      pointsTaken = redeemed.points;
    }

    const now = new Date();
    const etaMinutes = (fulfillment === 'delivery' ? restaurant.delivery : fulfillment === 'pickup' ? restaurant.pickup : restaurant.dineIn).etaMinutes;
    const initial = online ? 'pending_payment' : 'placed';
    const order = await insertOrder({
      _id: orderId,
      user: user?._id ?? null,
      customer,
      fulfillment,
      address,
      tableNumber,
      source,
      scheduledFor,
      notes: input.notes || undefined,
      items: quote.lines,
      totals: quote.totals,
      coupon: quote.coupon ? { code: quote.coupon.code, description: quote.coupon.description, discount: quote.coupon.discount, couponId: quote.coupon.couponId } : undefined,
      couponRecorded: couponTaken,
      loyaltyRedeemed: { points: pointsTaken, value: quote.loyalty?.value ?? 0 },
      payment: { method: input.paymentMethod, status: online ? 'pending' : 'cash_due', provider: online ? 'sandbox' : 'cod' },
      status: initial,
      statusHistory: [{ status: initial, at: now, by: user ? { id: user._id, name: user.name, role: 'customer' } : { name: 'Guest', role: 'guest' }, note: online ? 'Waiting for payment' : 'Order placed, pay on delivery' }],
      placedAt: online ? undefined : now,
      etaAt: scheduledFor ?? new Date(now.getTime() + etaMinutes * 60_000),
      idempotencyKey: input.idempotencyKey || undefined,
    });

    let session = null;
    if (online) session = await initiatePayment(order);
    else announcePlaced(order);

    if (user && input.saveAddress && address && fulfillment === 'delivery') {
      const count = await Address.countDocuments({ user: user._id });
      if (count < 8) await Address.create({ user: user._id, label: address.label || 'Home', recipient: address.recipient, phone: customer.phone, line1: address.line1, area: address.area, city: address.city, notes: address.notes, isDefault: count === 0 });
    }
    if (user) await Cart.updateOne({ user: user._id }, { $set: { items: [] } });
    return { order: await Order.findById(order._id), payment: paymentInfo(session) };
  } catch (err) {
    // Half-finished checkout: hand back anything we already took.
    if (couponTaken) await rollbackRedemption({ couponId: quote.coupon.couponId, orderId }).catch(() => {});
    if (pointsTaken) await grantPoints({ userId, points: pointsTaken, type: 'refund', note: 'Checkout did not complete' }).catch(() => {});
    throw err;
  }
}

// ---------------------------------------------------------------------------------------------------
// Status changes
// ---------------------------------------------------------------------------------------------------

async function runSideEffects(order, to, actor) {
  const safe = async (label, fn) => {
    try {
      await fn();
    } catch (err) {
      logger.error(`order side effect failed: ${label}`, { order: order.orderNumber, message: err.message });
    }
  };
  if (to === 'preparing') await safe('stock', () => deductStockForOrder(order, actor));
  if (to === 'delivered') {
    await safe('cash', async () => {
      if (order.payment.method === 'cod') {
        await Order.updateOne({ _id: order._id, 'payment.status': 'cash_due' }, { $set: { 'payment.status': 'paid', 'payment.paidAt': new Date() } });
      }
    });
    await safe('loyalty', () => awardForDeliveredOrder(order));
    await safe('sold', async () => {
      const ops = order.items.filter((i) => i.menuItem).map((i) => ({ updateOne: { filter: { _id: i.menuItem }, update: { $inc: { soldCount: i.quantity } } } }));
      if (ops.length) await MenuItem.bulkWrite(ops);
    });
    await safe('review-invite', async () => {
      if (order.user) {
        await notifyUser(order.user, { type: 'review', title: 'How was your order?', body: `Tell us about ${order.orderNumber}. Your review helps other guests choose.`, link: '/account/reviews', prefKey: 'orderUpdates' });
      }
    });
  }
  if (to === 'cancelled' || to === 'rejected') {
    await safe('points', () => refundRedeemedPoints(order));
    await safe('coupon', () => releaseCoupon(order));
    await safe('payment', async () => {
      await cancelPendingPayment(order);
      if (order.payment.status === 'paid' && order.payment.provider === 'sandbox') {
        await refundPayment(order, { reason: `Order ${to}`, actor });
      }
    });
  }
}

/** Persists one status change (history entry with actor), runs its side effects, then broadcasts and notifies. */
export async function transitionOrder({ order: loaded, orderId, toStatus, actor, note, reason }) {
  const order = loaded ?? (await Order.findById(orderId));
  if (!order) throw notFound('Order not found.');
  const verdict = canTransition(order, toStatus, actor);
  if (!verdict.ok) throw new ApiError(verdict.status, verdict.code, verdict.reason);

  const from = order.status;
  const now = new Date();
  const set = { status: toStatus };
  if (TIME_FIELD[toStatus]) set[TIME_FIELD[toStatus]] = now;
  const filter = { _id: order._id, status: from };
  if (toStatus === 'out_for_delivery' && actor?.role === 'delivery') {
    set.assignedDelivery = actor.id;
    filter.assignedDelivery = { $in: [null, actor.id] };
  }
  if (toStatus === 'cancelled' || toStatus === 'rejected') set.cancellation = { reason: reason || note || undefined, by: actor?.role ?? 'system' };

  const updated = await Order.findOneAndUpdate(
    filter,
    { $set: set, $push: { statusHistory: { status: toStatus, at: now, by: { id: actor?.id, name: actor?.name, role: actor?.role }, note: note || undefined } } },
    { new: true },
  );
  if (!updated) throw conflict('Someone else just updated this order. Refresh and try again.', 'STALE_STATUS');

  await runSideEffects(updated, toStatus, actor);
  const fresh = (await Order.findById(updated._id)) ?? updated;
  emitOrderUpdate(fresh);
  await notifyCustomer(fresh, toStatus);
  return fresh;
}

/** Customer or staff cancellation. Customers are limited to pending_payment and placed by canTransition. */
export async function cancelOrder({ order, actor, reason }) {
  return transitionOrder({ order, toStatus: 'cancelled', actor, reason: reason || 'Cancelled by request', note: reason });
}

/** Managers can hand a ready or travelling delivery to a specific rider. */
export async function assignDelivery({ order, riderId, actor }) {
  if (order.fulfillment !== 'delivery') throw conflict('Only delivery orders can be assigned to a rider.', 'NOT_DELIVERY');
  if (!['placed', 'confirmed', 'preparing', 'ready', 'out_for_delivery'].includes(order.status)) throw conflict('This order can no longer be assigned.', 'NOT_ASSIGNABLE');
  const rider = await User.findOne({ _id: riderId, role: 'delivery', status: 'active' }).select('name');
  if (!rider) throw notFound('That rider was not found.');
  const updated = await Order.findOneAndUpdate({ _id: order._id, status: order.status }, { $set: { assignedDelivery: rider._id } }, { new: true });
  if (!updated) throw conflict('The order changed while you were assigning it. Try again.', 'STALE_STATUS');
  emitOrderUpdate(updated);
  await notifyUser(rider._id, { type: 'order', title: `Delivery assigned: ${updated.orderNumber}`, body: `${updated.address?.area ?? ''}`.trim() || undefined, link: '/staff' });
  logger.info('delivery assigned', { order: updated.orderNumber, by: actor?.name });
  return updated;
}

/** Retry payment for an order still waiting in pending_payment. */
export async function restartPayment(order) {
  if (order.status !== 'pending_payment') throw conflict('This order is no longer waiting for payment.', 'NOT_PENDING');
  if (order.payment.method === 'cod') throw conflict('This order is pay on delivery.', 'NOT_ONLINE');
  await Payment.updateMany({ order: order._id, status: { $in: ['initiated', 'pending'] } }, { $set: { status: 'cancelled' } });
  return paymentInfo(await initiatePayment(order));
}

/** Cancels orders whose payment window has closed. Runs every minute (jobs/orderSweep.jobs.js). */
export async function sweepUnpaidOrders(now = new Date()) {
  const cutoff = new Date(now.getTime() - 30 * 60_000);
  const stale = await Order.find({ status: 'pending_payment', createdAt: { $lt: cutoff } }).limit(50);
  let cancelled = 0;
  for (const order of stale) {
    const latest = order.payment?.paymentId ? await Payment.findById(order.payment.paymentId).select('status sessionExpiresAt').lean() : null;
    if (latest?.status === 'pending' && latest.sessionExpiresAt > now) continue; // a retry is still open
    try {
      await transitionOrder({ order, toStatus: 'cancelled', actor: SYSTEM, note: 'Payment was not completed in time', reason: 'Payment window expired' });
      cancelled += 1;
    } catch (err) {
      logger.warn('sweep could not cancel order', { order: order.orderNumber, message: err.message });
    }
  }
  return cancelled;
}
