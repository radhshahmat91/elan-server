import { baseSchema, defineModel, Schema, ObjectId } from './_base.js';
import { REVIEW_STATUSES } from './constants.js';

const reviewSchema = baseSchema({
  user: { type: ObjectId, ref: 'User', required: true, index: true },
  order: { type: ObjectId, ref: 'Order', required: true }, // verified purchase: the order must belong to the user and be delivered
  menuItem: { type: ObjectId, ref: 'MenuItem', default: null, index: true }, // null = review of the whole visit
  rating: { type: Number, required: true, min: 1, max: 5 },
  title: { type: String, maxlength: 80 },
  body: { type: String, required: true, maxlength: 1200 },
  photos: [{ type: String }],
  status: { type: String, enum: REVIEW_STATUSES, default: 'pending', index: true },
  verifiedPurchase: { type: Boolean, default: true },
  reply: { text: String, by: String, at: Date },
  authorName: { type: String, maxlength: 80 }, // display name captured at write time
  isDemo: { type: Boolean, default: false }, // seeded sample reviews are labelled as demo data in the UI
});

reviewSchema.index({ user: 1, order: 1, menuItem: 1 }, { unique: true });
reviewSchema.index({ status: 1, createdAt: -1 });

export const Review = defineModel('Review', reviewSchema);
