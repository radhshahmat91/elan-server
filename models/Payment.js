import { baseSchema, defineModel, Schema, ObjectId } from './_base.js';
import { PAYMENT_METHODS } from './constants.js';

// Provider callbacks are stored as events. A callback is applied at most once per eventId.
const eventSchema = new Schema(
  {
    eventId: { type: String, required: true },
    type: String, // 'payment.succeeded' | 'payment.failed' | 'payment.cancelled' | 'refund.succeeded'
    at: { type: Date, default: Date.now },
    amount: Number,
    currency: String,
    verified: { type: Boolean, default: false }, // signature, amount, currency and reference all matched
    note: String,
  },
  { _id: false },
);

const refundSchema = new Schema(
  {
    amount: { type: Number, required: true },
    reason: String,
    by: { id: ObjectId, name: String },
    at: { type: Date, default: Date.now },
  },
  { _id: false },
);

const paymentSchema = baseSchema({
  order: { type: ObjectId, ref: 'Order', required: true, index: true },
  user: { type: ObjectId, ref: 'User', default: null },
  provider: { type: String, enum: ['sandbox', 'cod', 'stripe', 'sslcommerz', 'bkash', 'nagad'], required: true },
  method: { type: String, enum: PAYMENT_METHODS, required: true },
  amount: { type: Number, required: true, min: 0 }, // whole BDT, copied from order.totals.total
  currency: { type: String, default: 'BDT' },
  status: {
    type: String,
    enum: ['initiated', 'pending', 'succeeded', 'failed', 'cancelled', 'refunded', 'partially_refunded'],
    default: 'initiated',
  },
  sessionId: { type: String, unique: true, sparse: true }, // provider checkout session
  sessionExpiresAt: Date,
  providerTxnId: String,
  events: [eventSchema],
  refunds: [refundSchema],
});

paymentSchema.index({ 'events.eventId': 1 });
paymentSchema.index({ status: 1, createdAt: -1 });

export const Payment = defineModel('Payment', paymentSchema);
