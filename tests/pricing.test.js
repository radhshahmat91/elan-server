import test from 'node:test';
import assert from 'node:assert/strict';
import { computeTotals, planRedemption, priceLine } from '../services/pricingService.js';

const restaurant = { taxRate: 0.05, serviceChargeRate: 0.1, delivery: { baseFee: 120, freeOver: 3000, minOrder: 600 } };

test('delivery below the free threshold pays the base fee; tax applies to the food only', () => {
  const t = computeTotals({ subtotal: 1000, fulfillment: 'delivery', restaurant });
  assert.deepEqual(t, { subtotal: 1000, discount: 0, loyaltyDiscount: 0, deliveryFee: 120, serviceCharge: 0, tax: 50, total: 1170 });
});

test('delivery is free at or above the threshold', () => {
  assert.equal(computeTotals({ subtotal: 3000, fulfillment: 'delivery', restaurant }).deliveryFee, 0);
  assert.equal(computeTotals({ subtotal: 2999, fulfillment: 'delivery', restaurant }).deliveryFee, 120);
});

test('pickup never pays delivery or service charge', () => {
  const t = computeTotals({ subtotal: 1000, fulfillment: 'pickup', restaurant });
  assert.equal(t.deliveryFee, 0);
  assert.equal(t.serviceCharge, 0);
  assert.equal(t.total, 1050);
});

test('dine-in adds a service charge before tax', () => {
  const t = computeTotals({ subtotal: 2000, fulfillment: 'dine_in', restaurant });
  assert.equal(t.serviceCharge, 200);
  assert.equal(t.tax, 110); // (2000 + 200) x 5%
  assert.equal(t.total, 2310);
});

test('discounts reduce the taxable amount; a free-delivery coupon zeroes the fee', () => {
  const t = computeTotals({ subtotal: 1000, discount: 100, loyaltyDiscount: 50, fulfillment: 'delivery', freeDelivery: true, restaurant });
  assert.equal(t.deliveryFee, 0);
  assert.equal(t.tax, 43); // round(850 x 0.05) = 42.5 -> 43
  assert.equal(t.total, 893);
});

test('a discount larger than the subtotal never makes the total negative', () => {
  const t = computeTotals({ subtotal: 300, discount: 500, fulfillment: 'pickup', restaurant });
  assert.equal(t.total, 0);
});

const group = (over = {}) => ({
  key: 'cook', name: 'Cooking level', isRequired: true, minSelect: 1, maxSelect: 1, active: true,
  choices: [{ key: 'medium', name: 'Medium', priceDelta: 0, available: true }, { key: 'well', name: 'Well done', priceDelta: 50, available: true }, { key: 'gone', name: 'Rare', priceDelta: 0, available: false }],
  ...over,
});
const item = (over = {}) => ({ _id: 'i1', slug: 'ribeye', name: 'Ribeye', price: 2000, salePrice: null, available: true, archived: false, optionGroups: [group()], images: [], ...over });

test('option deltas and quantity are priced by the server', () => {
  const { line, issues } = priceLine(item(), { menuItemId: 'i1', quantity: 2, selections: [{ group: 'cook', choices: ['well'] }] });
  assert.equal(issues.length, 0);
  assert.equal(line.unitPrice, 2050);
  assert.equal(line.lineTotal, 4100);
  assert.equal(line.options[0].choiceName, 'Well done');
});

test('a sale price replaces the base price', () => {
  const { line } = priceLine(item({ salePrice: 1500 }), { quantity: 1, selections: [{ group: 'cook', choices: ['medium'] }] });
  assert.equal(line.basePrice, 1500);
  assert.equal(line.unitPrice, 1500);
});

test('a required group without a choice is a blocking issue', () => {
  const { issues } = priceLine(item(), { quantity: 1, selections: [] });
  assert.equal(issues[0].code, 'OPTION_REQUIRED');
});

test('too many choices, unknown groups and unavailable choices are rejected', () => {
  assert.ok(priceLine(item(), { quantity: 1, selections: [{ group: 'cook', choices: ['medium', 'well'] }] }).issues.some((i) => i.code === 'OPTION_TOO_MANY'));
  assert.ok(priceLine(item(), { quantity: 1, selections: [{ group: 'nope', choices: ['x'] }, { group: 'cook', choices: ['medium'] }] }).issues.some((i) => i.code === 'INVALID_OPTION'));
  assert.ok(priceLine(item(), { quantity: 1, selections: [{ group: 'cook', choices: ['gone'] }] }).issues.some((i) => i.code === 'INVALID_OPTION'));
});

test('unavailable, archived and out-of-range quantities are blocking', () => {
  const sel = [{ group: 'cook', choices: ['medium'] }];
  assert.ok(priceLine(item({ available: false }), { quantity: 1, selections: sel }).issues.some((i) => i.code === 'ITEM_UNAVAILABLE'));
  assert.ok(priceLine(item({ archived: true }), { quantity: 1, selections: sel }).issues.some((i) => i.code === 'ITEM_UNAVAILABLE'));
  assert.ok(priceLine(item(), { quantity: 0, selections: sel }).issues.some((i) => i.code === 'BAD_QUANTITY'));
  assert.ok(priceLine(item(), { quantity: 21, selections: sel }).issues.some((i) => i.code === 'BAD_QUANTITY'));
  assert.ok(priceLine(item(), { quantity: 1.5, selections: sel }).issues.some((i) => i.code === 'BAD_QUANTITY'));
});

test('client-supplied prices are ignored: only ids, quantities and keys matter', () => {
  const { line } = priceLine(item(), { quantity: 1, price: 1, unitPrice: 1, selections: [{ group: 'cook', choices: ['medium'], priceDelta: -999 }] });
  assert.equal(line.unitPrice, 2000);
});

test('loyalty redemption is clamped to balance and to what is left to pay', () => {
  const rules = { minRedeem: 100, pointValue: 0.5 };
  assert.deepEqual(planRedemption({ requested: 400, balance: 1000, cap: 5000, ...rules }), { points: 400, value: 200, reason: null });
  assert.equal(planRedemption({ requested: 400, balance: 250, cap: 5000, ...rules }).points, 250);
  assert.equal(planRedemption({ requested: 5000, balance: 9000, cap: 300, ...rules }).points, 600);
  assert.equal(planRedemption({ requested: 5000, balance: 9000, cap: 300, ...rules }).value, 300);
  assert.equal(planRedemption({ requested: 50, balance: 1000, cap: 5000, ...rules }).points, 0);
  assert.equal(planRedemption({ requested: 0, balance: 1000, cap: 5000, ...rules }).points, 0);
});
