import { baseSchema, defineModel, Schema, ObjectId } from './_base.js';
import { FULFILLMENT, ORDER_STATUSES, PAYMENT_METHODS, PAYMENT_STATUSES } from './constants.js';

// Historical orders keep a snapshot of what was sold (name, options, price) so later menu edits
// never rewrite the past.
const optionSnapshot = new Schema(
  {
    group: String, // AddOn.key
    groupName: String,
    groupNameBn: String,
    choice: String, // choice key
    choiceName: String,
    choiceNameBn: String,
    priceDelta: { type: Number, default: 0 },
  },
  { _id: false },
);

const itemSchema = new Schema(
  {
    menuItem: { type: ObjectId, ref: 'MenuItem' },
    slug: String,
    name: { type: String, required: true },
    nameBn: String,
    categoryName: String,
    art: { motif: String, palette: [String], seed: Number },
    image: String,
    basePrice: { type: Number, required: true }, // sale price when the order was placed
    unitPrice: { type: Number, required: true }, // basePrice + option deltas
    quantity: { type: Number, required: true, min: 1 },
    options: [optionSnapshot],
    note: { type: String, maxlength: 200 },
    lineTotal: { type: Number, required: true },
    prepMinutes: Number,
  },
  { _id: false },
);

const historySchema = new Schema(
  {
    status: { type: String, enum: ORDER_STATUSES, required: true },
    at: { type: Date, default: Date.now },
    by: { id: ObjectId, name: String, role: String }, // actor; role 'system' for automatic changes
    note: { type: String, maxlength: 300 },
  },
  { _id: false },
);

const orderSchema = baseSchema({
  publicId: { type: String, required: true, unique: true }, // unguessable, used in tracking links
  orderNumber: { type: String, required: true, unique: true }, // readable, e.g. EL-261104-4821
  user: { type: ObjectId, ref: 'User', default: null, index: true }, // null for guest checkout
  customer: {
    name: { type: String, required: true, maxlength: 80 },
    phone: { type: String, required: true, maxlength: 24 },
    email: { type: String, lowercase: true, maxlength: 160 },
  },

  fulfillment: { type: String, enum: FULFILLMENT, required: true },
  address: { label: String, recipient: String, line1: String, area: String, city: String, notes: String },
  tableNumber: { type: String }, // dine_in (QR ordering)
  source: { type: String, enum: ['web', 'qr'], default: 'web' },
  scheduledFor: { type: Date, default: null },
  notes: { type: String, maxlength: 400 },

  items: { type: [itemSchema], validate: (v) => v.length > 0 },

  totals: {
    subtotal: { type: Number, required: true },
    discount: { type: Number, default: 0 }, // coupon
    loyaltyDiscount: { type: Number, default: 0 },
    deliveryFee: { type: Number, default: 0 },
    serviceCharge: { type: Number, default: 0 },
    tax: { type: Number, default: 0 },
    total: { type: Number, required: true },
  },
  coupon: { code: String, description: String, discount: Number, couponId: ObjectId },
  loyaltyRedeemed: { points: { type: Number, default: 0 }, value: { type: Number, default: 0 } },

  payment: {
    method: { type: String, enum: PAYMENT_METHODS, required: true },
    status: { type: String, enum: PAYMENT_STATUSES, default: 'unpaid' },
    provider: String, // 'sandbox' | 'cod'
    paymentId: { type: ObjectId, ref: 'Payment' },
    paidAt: Date,
    refundedTotal: { type: Number, default: 0 },
  },

  status: { type: String, enum: ORDER_STATUSES, default: 'placed', index: true },
  statusHistory: [historySchema],
  cancellation: { reason: String, by: String },
  assignedDelivery: { type: ObjectId, ref: 'User', default: null },
  etaAt: Date,

  // Timestamps used by analytics (fulfilment time, funnel).
  placedAt: Date,
  confirmedAt: Date,
  preparingAt: Date,
  readyAt: Date,
  deliveredAt: Date,

  // Idempotency flags: each side effect runs at most once per order.
  stockDeducted: { type: Boolean, default: false },
  loyaltyAwarded: { type: Boolean, default: false },
  loyaltyRefunded: { type: Boolean, default: false },
  couponRecorded: { type: Boolean, default: false },
  idempotencyKey: { type: String },
  isDemo: { type: Boolean, default: false },
});

orderSchema.index({ user: 1, createdAt: -1 });
orderSchema.index({ status: 1, createdAt: -1 });
orderSchema.index({ createdAt: -1 });
orderSchema.index({ 'payment.status': 1 });
orderSchema.index({ 'customer.phone': 1 });
orderSchema.index({ assignedDelivery: 1, status: 1 });
orderSchema.index(
  { idempotencyKey: 1 },
  { unique: true, partialFilterExpression: { idempotencyKey: { $type: 'string' } } },
);

export const Order = defineModel('Order', orderSchema);
