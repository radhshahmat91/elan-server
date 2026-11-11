import { baseSchema, defineModel, ObjectId } from './_base.js';
import { LOYALTY_TYPES } from './constants.js';

// Append-only points ledger. `points` is signed (earn > 0, redeem < 0).
const loyaltySchema = baseSchema({
  user: { type: ObjectId, ref: 'User', required: true, index: true },
  type: { type: String, enum: LOYALTY_TYPES, required: true },
  points: { type: Number, required: true },
  balanceAfter: { type: Number, required: true, min: 0 },
  order: { type: ObjectId, ref: 'Order' },
  note: { type: String, maxlength: 200 },
  createdBy: { type: ObjectId, ref: 'User' },
});

loyaltySchema.index({ user: 1, createdAt: -1 });

export const LoyaltyTransaction = defineModel('LoyaltyTransaction', loyaltySchema);
