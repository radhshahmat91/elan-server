import { baseSchema, defineModel, Schema, ObjectId } from './_base.js';
import { COUPON_TYPES, FULFILLMENT } from './constants.js';

const redemptionSchema = new Schema(
  { user: { type: ObjectId, ref: 'User' }, order: { type: ObjectId, ref: 'Order' }, at: { type: Date, default: Date.now } },
  { _id: false },
);

const couponSchema = baseSchema({
  code: { type: String, required: true, unique: true, uppercase: true, trim: true, maxlength: 24 },
  description: { type: String, maxlength: 200 },
  type: { type: String, enum: COUPON_TYPES, required: true },
  value: { type: Number, default: 0, min: 0 }, // percent (0-100) or whole BDT; ignored for free_delivery
  maxDiscount: { type: Number, default: null }, // cap for percent coupons
  minOrder: { type: Number, default: 0 },
  startsAt: { type: Date, default: null },
  expiresAt: { type: Date, default: null },
  usageLimit: { type: Number, default: null }, // total redemptions; null = unlimited
  perUserLimit: { type: Number, default: 1 },
  usedCount: { type: Number, default: 0 },
  firstOrderOnly: { type: Boolean, default: false },
  appliesTo: { type: [{ type: String, enum: FULFILLMENT }], default: [] }, // empty = every fulfilment type
  active: { type: Boolean, default: true },

  // Special-offers section on the homepage.
  showOnSite: { type: Boolean, default: false },
  headline: { type: String, maxlength: 80 },
  terms: { type: String, maxlength: 300 },
  redemptions: { type: [redemptionSchema], default: [] },
});

couponSchema.index({ active: 1, showOnSite: 1 });

export const Coupon = defineModel('Coupon', couponSchema);
