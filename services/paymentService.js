// Payments. The only provider in this build is a clearly labelled SANDBOX gateway (card, bKash and Nagad all route to it).
// The rule that matters is the same one a real gateway needs: the browser never decides that an order is paid.
// An order becomes paid only inside handleProviderEvent(), after the HMAC signature, order reference, amount and
// currency all check out, and each provider event id is applied once.
import { Order, Payment } from '../models/index.js';
import { env } from '../config/env.js';
import { hmacHex, randomToken, safeEqual } from '../utils/crypto.js';
import { ApiError, badRequest, conflict, notFound } from '../utils/errors.js';
import { bdt } from '../utils/format.js';
import { logger } from '../utils/logger.js';
import { announcePlaced, emitOrderUpdate } from './orderEvents.js';
import { notifyUser, sendEmail } from './notificationService.js';
import { emailLayout, escapeHtml } from '../utils/emailLayout.js';

export const CURRENCY = 'BDT';
export const SESSION_MINUTES = 30;
const MAX_ATTEMPTS = 6;
const SYSTEM = { name: 'Payment gateway', role: 'system' };

/** Starts (or restarts) a sandbox checkout session for an order waiting in `pending_payment`. */
export async function initiatePayment(order) {
  const attempts = await Payment.countDocuments({ order: order._id });
  if (attempts >= MAX_ATTEMPTS) throw conflict('Too many payment attempts for this order. Please place a new order.', 'TOO_MANY_ATTEMPTS');
  const sessionId = `sbx_${randomToken(18)}`;
  const expiresAt = new Date(Date.now() + SESSION_MINUTES * 60_000);
  const payment = await Payment.create({
    order: order._id,
    user: order.user ?? null,
    provider: 'sandbox',
    method: order.payment.method,
    amount: order.totals.total,
    currency: CURRENCY,
    status: 'pending',
    sessionId,
    sessionExpiresAt: expiresAt,
  });
  await Order.updateOne({ _id: order._id }, { $set: { 'payment.paymentId': payment._id, 'payment.provider': 'sandbox', 'payment.status': 'pending' } });
  return { sessionId, redirectUrl: `${env.PUBLIC_CLIENT_URL}/payment/sandbox?session=${sessionId}`, expiresAt, paymentId: String(payment._id) };
}

/** What a real gateway would POST to our webhook: the event body and its signature over the raw bytes. */
export function buildSandboxCallback({ payment, order, outcome }) {
  const event = {
    eventId: `evt_${randomToken(9)}`,
    type: `payment.${outcome}`,
    sessionId: payment.sessionId,
    orderNumber: order.orderNumber,
    amount: payment.amount,
    currency: payment.currency,
    at: new Date().toISOString(),
  };
  const rawBody = JSON.stringify(event);
  return { event, rawBody, signature: hmacHex(env.PAYMENT_WEBHOOK_SECRET, rawBody) };
}

/** Pure: constant-time HMAC-SHA256 check over the raw body. */
export function verifySignature(rawBody, signature, secret = env.PAYMENT_WEBHOOK_SECRET) {
  if (!rawBody || !signature) return false;
  const body = Buffer.isBuffer(rawBody) ? rawBody : Buffer.from(String(rawBody));
  return safeEqual(hmacHex(secret, body), String(signature));
}

/** Public view of a sandbox checkout session (no personal data). */
export async function getSandboxSession(sessionId) {
  const payment = await Payment.findOne({ sessionId }).lean();
  if (!payment) throw notFound('That payment session does not exist.');
  const order = await Order.findById(payment.order).lean();
  if (!order) throw notFound('That payment session does not exist.');
  const expired = payment.status === 'pending' && payment.sessionExpiresAt < new Date();
  return {
    sandbox: true,
    sessionId,
    status: expired ? 'expired' : payment.status,
    expiresAt: payment.sessionExpiresAt,
    amount: payment.amount,
    currency: payment.currency,
    method: payment.method,
    order: {
      publicId: order.publicId,
      orderNumber: order.orderNumber,
      status: order.status,
      lines: order.items.map((i) => ({ name: i.name, quantity: i.quantity, lineTotal: i.lineTotal })),
      totals: order.totals,
    },
  };
}

/**
 * The sandbox "gateway" button. It plays the part of the provider: it signs an event exactly as a real provider would
 * and feeds it through handleProviderEvent, the same path the webhook endpoint uses.
 */
export async function completeSandboxSession(sessionId, outcome) {
  const payment = await Payment.findOne({ sessionId });
  if (!payment) throw notFound('That payment session does not exist.');
  if (payment.status !== 'pending') throw conflict('This payment session is already closed.', 'SESSION_CLOSED');
  if (payment.sessionExpiresAt < new Date()) throw conflict('This payment session expired. Open your order and pay again.', 'SESSION_EXPIRED');
  const order = await Order.findById(payment.order);
  if (!order) throw notFound('Order not found.');
  const callback = buildSandboxCallback({ payment, order, outcome });
  const result = await handleProviderEvent({ provider: 'sandbox', rawBody: callback.rawBody, signature: callback.signature });
  return { ...result, order: { publicId: order.publicId, orderNumber: order.orderNumber } };
}

/** The ONE place payment outcomes are applied. */
export async function handleProviderEvent({ provider, rawBody, signature }) {
  if (provider !== 'sandbox') throw badRequest('Unknown payment provider.');
  const raw = Buffer.isBuffer(rawBody) ? rawBody : Buffer.from(rawBody ?? '');
  if (!verifySignature(raw, signature)) throw new ApiError(401, 'BAD_SIGNATURE', 'The payment signature did not match.');

  let event;
  try {
    event = JSON.parse(raw.toString('utf8'));
  } catch {
    throw badRequest('The payment event is not valid JSON.');
  }
  const { eventId, type, sessionId } = event ?? {};
  if (!eventId || !type || !sessionId) throw badRequest('The payment event is missing fields.');

  const payment = await Payment.findOne({ sessionId });
  if (!payment) throw notFound('Unknown payment session.');
  const order = await Order.findById(payment.order);
  if (!order) throw notFound('Unknown order.');

  const verified =
    event.orderNumber === order.orderNumber &&
    Number(event.amount) === payment.amount &&
    payment.amount === order.totals.total &&
    event.currency === payment.currency;

  // Record the event exactly once. A repeated delivery (gateways retry) stops here.
  const recorded = await Payment.findOneAndUpdate(
    { _id: payment._id, 'events.eventId': { $ne: eventId } },
    { $push: { events: { eventId, type, at: new Date(event.at ?? Date.now()), amount: event.amount, currency: event.currency, verified } } },
    { new: true },
  );
  if (!recorded) return { applied: false, duplicate: true };
  if (!verified) {
    logger.warn('payment event rejected: reference, amount or currency mismatch', { eventId, order: order.orderNumber });
    return { applied: false, reason: 'MISMATCH' };
  }

  if (type === 'payment.succeeded') return applySuccess(recorded, order);
  if (type === 'payment.failed' || type === 'payment.cancelled') return applyFailure(recorded, order, type);
  return { applied: false, reason: 'IGNORED' };
}

async function applySuccess(payment, order) {
  const paidAt = new Date();
  const placed = await Order.findOneAndUpdate(
    { _id: order._id, status: 'pending_payment' },
    {
      $set: { status: 'placed', placedAt: paidAt, 'payment.status': 'paid', 'payment.paidAt': paidAt, 'payment.paymentId': payment._id },
      $push: { statusHistory: { status: 'placed', at: paidAt, by: SYSTEM, note: 'Payment confirmed' } },
    },
    { new: true },
  );
  await Payment.updateOne({ _id: payment._id }, { $set: { status: 'succeeded', providerTxnId: `sbxtx_${randomToken(8)}` } });
  if (placed) {
    await announcePlaced(placed);
    return { applied: true, status: 'paid' };
  }
  // The order was already cancelled (the payment window closed first), so the money arrived late: give it back.
  const late = await Order.findById(order._id);
  if (late) await refundPayment(late, { reason: 'Payment arrived after the order was cancelled', actor: SYSTEM });
  return { applied: true, status: 'refunded_late' };
}

async function applyFailure(payment, order, type) {
  await Payment.updateOne({ _id: payment._id, status: 'pending' }, { $set: { status: type === 'payment.cancelled' ? 'cancelled' : 'failed' } });
  const failed = await Order.findOneAndUpdate({ _id: order._id, status: 'pending_payment' }, { $set: { 'payment.status': 'failed' } }, { new: true });
  if (failed) {
    emitOrderUpdate(failed);
    const link = `/track-order/${failed.publicId}`;
    const title = type === 'payment.cancelled' ? 'Payment cancelled' : 'Payment did not go through';
    const body = `Order ${failed.orderNumber} is still waiting. You can try again for the next 30 minutes.`;
    const email = {
      subject: `${title} (${failed.orderNumber})`,
      html: emailLayout({ title, preheader: body, bodyHtml: `<p style="margin:0">${escapeHtml(body)}</p>`, cta: { label: 'Try payment again', url: `${env.PUBLIC_CLIENT_URL}${link}` } }),
    };
    if (failed.user) await notifyUser(failed.user, { type: 'order', title, body, link, prefKey: 'orderUpdates', email });
    else if (failed.customer?.email) await sendEmail({ to: failed.customer.email, ...email });
  }
  return { applied: true, status: type === 'payment.cancelled' ? 'cancelled' : 'failed' };
}

/** Closes any payment attempts that are still open (order cancelled or expired). */
export async function cancelPendingPayment(order) {
  await Payment.updateMany({ order: order._id, status: { $in: ['initiated', 'pending', 'failed'] } }, { $set: { status: 'cancelled' } });
}

/** Sandbox refund of a captured payment (full when `amount` is omitted). Updates the order's payment state. */
export async function refundPayment(order, { amount, reason, actor } = {}) {
  const payment = await Payment.findOne({ order: order._id, status: { $in: ['succeeded', 'partially_refunded'] } }).sort({ createdAt: -1 });
  if (!payment) throw conflict('There is no captured payment on this order to refund.', 'NOTHING_TO_REFUND');
  const refunded = (payment.refunds ?? []).reduce((sum, r) => sum + r.amount, 0);
  const remaining = payment.amount - refunded;
  const value = amount == null ? remaining : Math.round(Number(amount));
  if (!(value > 0) || value > remaining) throw conflict(`You can refund up to ${bdt(remaining)} on this order.`, 'REFUND_TOO_HIGH');
  const full = value === remaining;
  const status = full ? 'refunded' : 'partially_refunded';
  await Payment.updateOne(
    { _id: payment._id },
    { $push: { refunds: { amount: value, reason, by: actor?.id ? { id: actor.id, name: actor.name } : { name: actor?.name ?? 'System' }, at: new Date() } }, $set: { status } },
  );
  await Order.updateOne({ _id: order._id }, { $set: { 'payment.status': status }, $inc: { 'payment.refundedTotal': value } });
  return { refunded: value, status };
}
