import { baseSchema, defineModel, ObjectId } from './_base.js';
import { ROLES, USER_STATUSES } from './constants.js';

const userSchema = baseSchema(
  {
    name: { type: String, required: true, trim: true, maxlength: 80 },
    email: { type: String, required: true, unique: true, lowercase: true, trim: true, maxlength: 160 },
    phone: { type: String, trim: true, maxlength: 24 },
    passwordHash: { type: String, select: false },
    role: { type: String, enum: ROLES, default: 'customer', index: true },
    status: { type: String, enum: USER_STATUSES, default: 'active', index: true },
    avatarUrl: { type: String, trim: true },
    birthday: { type: Date },
    marketingOptIn: { type: Boolean, default: false },
    notificationPrefs: {
      orderUpdates: { type: Boolean, default: true },
      reservationUpdates: { type: Boolean, default: true },
      promotions: { type: Boolean, default: false },
    },
    referralCode: { type: String, unique: true, sparse: true },
    referredBy: { type: ObjectId, ref: 'User' },
    referralRewarded: { type: Boolean, default: false },
    birthdayBonusYear: { type: Number }, // the year the birthday bonus was last granted, so it is given once a year
    // Cached loyalty balance. The ledger (LoyaltyTransaction) is the source of truth.
    loyalty: {
      points: { type: Number, default: 0, min: 0 },
      lifetime: { type: Number, default: 0, min: 0 },
      tier: { type: String, default: 'initie' },
    },
    favorites: [{ type: ObjectId, ref: 'MenuItem' }],
    recentlyViewed: [{ type: ObjectId, ref: 'MenuItem' }],
    lastLoginAt: { type: Date },
    failedLogins: { type: Number, default: 0 },
    lockedUntil: { type: Date },
    isDemo: { type: Boolean, default: false },
  },
  { hidden: ['passwordHash', 'failedLogins', 'lockedUntil'] },
);

userSchema.index({ role: 1, status: 1 });

export const User = defineModel('User', userSchema);
