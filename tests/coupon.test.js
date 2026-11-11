import test from 'node:test';
import assert from 'node:assert/strict';
import { evaluateCouponRules } from '../services/couponService.js';

const base = { code: 'WELCOME', active: true, type: 'percent', value: 10, maxDiscount: 300, minOrder: 500, usageLimit: null, usedCount: 0, perUserLimit: 1, firstOrderOnly: false, appliesTo: [] };
const ctx = { subtotal: 2000, deliveryFee: 120, fulfillment: 'delivery', userUses: 0, isFirstOrder: true, signedIn: true };

test('percent coupon is rounded and capped by maxDiscount', () => {
  assert.equal(evaluateCouponRules(base, { ...ctx, subtotal: 1234 }).discount, 123);
  assert.equal(evaluateCouponRules(base, { ...ctx, subtotal: 9000 }).discount, 300);
});

test('fixed coupon never exceeds the subtotal', () => {
  const fixed = { ...base, type: 'fixed', value: 800, minOrder: 0 };
  assert.equal(evaluateCouponRules(fixed, { ...ctx, subtotal: 600 }).discount, 600);
  assert.equal(evaluateCouponRules(fixed, { ...ctx, subtotal: 2000 }).discount, 800);
});

test('free delivery coupon reports the fee it removes', () => {
  const r = evaluateCouponRules({ ...base, type: 'free_delivery', minOrder: 0 }, ctx);
  assert.equal(r.valid, true);
  assert.equal(r.freeDelivery, true);
  assert.equal(r.discount, 120);
});

test('every rejection reason is reported with a plain message', () => {
  const now = new Date('2026-11-05T12:00:00Z');
  const reasons = (coupon, extra = {}) => evaluateCouponRules(coupon, { ...ctx, ...extra }, now).reason;
  assert.equal(evaluateCouponRules(null, ctx).reason, 'not_found');
  assert.equal(reasons({ ...base, active: false }), 'inactive');
  assert.equal(reasons({ ...base, startsAt: '2026-12-01T00:00:00Z' }), 'not_started');
  assert.equal(reasons({ ...base, expiresAt: '2026-11-01T00:00:00Z' }), 'expired');
  assert.equal(reasons({ ...base, usageLimit: 5, usedCount: 5 }), 'exhausted');
  assert.equal(reasons({ ...base, appliesTo: ['pickup'] }), 'fulfillment');
  assert.equal(reasons(base, { subtotal: 300 }), 'min_order');
  assert.equal(reasons({ ...base, firstOrderOnly: true }, { isFirstOrder: false }), 'first_order_only');
  assert.equal(reasons({ ...base, firstOrderOnly: true }, { signedIn: false }), 'signin_required');
  assert.equal(reasons(base, { userUses: 1 }), 'user_limit');
  const bad = evaluateCouponRules(base, { ...ctx, subtotal: 300 }, now);
  assert.match(bad.message, /৳500/);
});

test('an unlimited per-user coupon can be used repeatedly', () => {
  assert.equal(evaluateCouponRules({ ...base, perUserLimit: 0 }, { ...ctx, userUses: 40 }).valid, true);
});
