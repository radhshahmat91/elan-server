// Server-authoritative pricing. The browser never sends a price: it sends item ids, quantities and option keys,
// and this module decides what everything costs. Every amount is a whole-BDT integer.
import mongoose from 'mongoose';
import { MenuItem, User } from '../models/index.js';
import { getRestaurant, computeOpenState } from './restaurantService.js';
import { evaluateCoupon, couponMessage } from './couponService.js';
import { bdt } from '../utils/format.js';
import { FULFILLMENT } from '../models/constants.js';

export const MAX_LINES = 40;
export const MAX_QTY = 20;

/**
 * Pure. subtotal, coupon discount, loyalty discount, delivery fee, service charge, tax and total.
 * Tax and service charge are charged on what the guest actually pays for food (after discounts).
 */
export function computeTotals({ subtotal, discount = 0, loyaltyDiscount = 0, fulfillment, freeDelivery = false, restaurant }) {
  const net = Math.max(0, subtotal - discount - loyaltyDiscount);
  const deliveryFee = fulfillment === 'delivery' && !freeDelivery && subtotal < restaurant.delivery.freeOver ? restaurant.delivery.baseFee : 0;
  const serviceCharge = fulfillment === 'dine_in' ? Math.round(net * restaurant.serviceChargeRate) : 0;
  const taxable = net + serviceCharge;
  const tax = Math.round(taxable * restaurant.taxRate);
  return { subtotal, discount, loyaltyDiscount, deliveryFee, serviceCharge, tax, total: taxable + tax + deliveryFee };
}

/**
 * Pure. Prices one cart line against a menu item (with populated optionGroups).
 * Returns { line, issues }; `line` is the order-item snapshot, or null when the line is unusable.
 */
export function priceLine(item, line) {
  const issues = [];
  const itemId = String(item._id);
  const quantity = Number(line.quantity);
  if (!Number.isInteger(quantity) || quantity < 1 || quantity > MAX_QTY) {
    issues.push({ code: 'BAD_QUANTITY', message: `Choose between 1 and ${MAX_QTY} of ${item.name}.`, itemId });
  }
  if (item.archived || !item.available) {
    issues.push({ code: 'ITEM_UNAVAILABLE', message: `${item.name} is not available right now. Remove it to continue.`, itemId });
  }

  const groups = (item.optionGroups ?? []).filter((g) => g && g.key && g.active !== false);
  const byKey = new Map(groups.map((g) => [g.key, g]));
  const chosen = new Map();
  for (const selection of line.selections ?? []) {
    const group = byKey.get(selection.group);
    if (!group) {
      issues.push({ code: 'INVALID_OPTION', message: `"${selection.group}" is not an option for ${item.name}.`, itemId });
      continue;
    }
    const set = chosen.get(group.key) ?? new Set();
    for (const key of selection.choices ?? []) set.add(String(key));
    chosen.set(group.key, set);
  }

  const options = [];
  let delta = 0;
  for (const group of groups) {
    const keys = [...(chosen.get(group.key) ?? [])];
    const need = Math.max(group.minSelect ?? 0, group.isRequired ? 1 : 0);
    if (keys.length < need) {
      issues.push({
        code: 'OPTION_REQUIRED',
        message: need === 1 ? `Choose an option for ${group.name} on ${item.name}.` : `Choose at least ${need} options for ${group.name} on ${item.name}.`,
        itemId,
        field: group.key,
      });
    }
    if (keys.length > (group.maxSelect ?? 1)) {
      issues.push({ code: 'OPTION_TOO_MANY', message: `Choose at most ${group.maxSelect} for ${group.name} on ${item.name}.`, itemId, field: group.key });
    }
    for (const key of keys) {
      const choice = (group.choices ?? []).find((c) => c.key === key);
      if (!choice || choice.available === false) {
        issues.push({ code: 'INVALID_OPTION', message: `That choice for ${group.name} on ${item.name} is no longer available.`, itemId, field: group.key });
        continue;
      }
      delta += choice.priceDelta ?? 0;
      options.push({
        group: group.key,
        groupName: group.name,
        groupNameBn: group.nameBn,
        choice: choice.key,
        choiceName: choice.name,
        choiceNameBn: choice.nameBn,
        priceDelta: choice.priceDelta ?? 0,
      });
    }
  }

  const basePrice = item.salePrice ?? item.price;
  const unitPrice = basePrice + delta;
  const snapshot = {
    menuItem: item._id,
    slug: item.slug,
    name: item.name,
    nameBn: item.nameBn,
    categoryName: item.category?.name,
    art: item.art?.motif ? { motif: item.art.motif, palette: item.art.palette, seed: item.art.seed } : undefined,
    image: item.images?.[0]?.url,
    basePrice,
    unitPrice,
    quantity: Number.isInteger(quantity) ? quantity : 0,
    options,
    note: String(line.note ?? '').trim().slice(0, 200) || undefined,
    lineTotal: unitPrice * (Number.isInteger(quantity) ? quantity : 0),
    prepMinutes: item.prepMinutes,
  };
  return { line: snapshot, issues };
}

/** Pure. How many loyalty points can be applied, and what they are worth. */
export function planRedemption({ requested, balance, minRedeem, pointValue, cap }) {
  let points = Math.floor(Number(requested) || 0);
  if (points <= 0 || !(pointValue > 0)) return { points: 0, value: 0, reason: null };
  let reason = null;
  if (points > balance) {
    points = balance;
    reason = 'balance';
  }
  const maxForCap = Math.floor(Math.max(0, cap) / pointValue);
  if (points > maxForCap) {
    points = maxForCap;
    reason = 'cap';
  }
  if (points < minRedeem) return { points: 0, value: 0, reason: points <= 0 && reason === 'balance' ? 'balance' : 'min' };
  return { points, value: Math.floor(points * pointValue), reason };
}

/**
 * Server-authoritative quote.
 * input: { items:[{menuItemId, quantity, selections?, note?}], fulfillment, couponCode?, loyaltyPoints? }
 * context: { userId? }
 */
export async function buildQuote(input, context = {}) {
  const restaurant = await getRestaurant();
  const fulfillment = FULFILLMENT.includes(input.fulfillment) ? input.fulfillment : 'delivery';
  const issues = [];
  const warnings = [];
  const requested = Array.isArray(input.items) ? input.items : [];

  if (requested.length === 0) issues.push({ code: 'EMPTY_CART', message: 'Your cart is empty.' });
  if (requested.length > MAX_LINES) issues.push({ code: 'TOO_MANY_LINES', message: `A single order can hold up to ${MAX_LINES} lines.` });

  const ids = [...new Set(requested.map((l) => String(l.menuItemId)).filter((id) => mongoose.isValidObjectId(id)))];
  const docs = ids.length ? await MenuItem.find({ _id: { $in: ids } }).populate('optionGroups').populate('category', 'name').lean() : [];
  const byId = new Map(docs.map((d) => [String(d._id), d]));

  const lines = [];
  for (const line of requested.slice(0, MAX_LINES)) {
    const item = byId.get(String(line.menuItemId));
    if (!item) {
      issues.push({ code: 'ITEM_NOT_FOUND', message: 'An item in your cart is no longer on the menu. Remove it to continue.', itemId: String(line.menuItemId) });
      continue;
    }
    const priced = priceLine(item, line);
    issues.push(...priced.issues);
    if (priced.line && priced.line.quantity > 0) lines.push(priced.line);
  }

  const subtotal = lines.reduce((sum, l) => sum + l.lineTotal, 0);

  if (restaurant.acceptingOrders === false) {
    issues.push({ code: 'NOT_ACCEPTING', message: 'We are not taking online orders right now. Please try again later or call us.' });
  } else if (!computeOpenState(restaurant).openNow) {
    warnings.push({ code: 'CLOSED_NOW', message: 'The dining room is closed at the moment. Your order will be prepared when the kitchen opens.' });
  }
  if (fulfillment === 'delivery' && lines.length && subtotal < restaurant.delivery.minOrder) {
    const gap = restaurant.delivery.minOrder - subtotal;
    issues.push({
      code: 'MIN_ORDER',
      message: `Delivery orders start at ${bdt(restaurant.delivery.minOrder)}. Add ${bdt(gap)} more or choose pickup.`,
    });
  }

  // Coupon: a rejected code never blocks the order; the guest is told and the price stays honest.
  const baseDeliveryFee = fulfillment === 'delivery' && subtotal < restaurant.delivery.freeOver ? restaurant.delivery.baseFee : 0;
  let coupon = null;
  let discount = 0;
  let freeDelivery = false;
  if (input.couponCode && lines.length) {
    const result = await evaluateCoupon(input.couponCode, { subtotal, deliveryFee: baseDeliveryFee, fulfillment, userId: context.userId ?? null });
    if (result.valid) {
      discount = result.freeDelivery ? 0 : result.discount;
      freeDelivery = result.freeDelivery;
      coupon = { code: result.code, description: result.coupon.description, discount: result.discount, couponId: result.coupon.id, freeDelivery };
    } else {
      warnings.push({ code: 'COUPON_REJECTED', message: result.message ?? couponMessage(result.reason) });
    }
  }

  // Loyalty points: only for signed-in guests, clamped to the balance and to what is left to pay for food.
  let loyalty = null;
  if (Number(input.loyaltyPoints) > 0 && lines.length) {
    if (!context.userId) {
      warnings.push({ code: 'POINTS_SIGN_IN', message: 'Sign in to spend your reward points.' });
    } else {
      const user = await User.findById(context.userId).select('loyalty').lean();
      const plan = planRedemption({
        requested: input.loyaltyPoints,
        balance: user?.loyalty?.points ?? 0,
        minRedeem: restaurant.loyalty.minRedeem,
        pointValue: restaurant.loyalty.pointValue,
        cap: subtotal - discount,
      });
      if (plan.points > 0) {
        loyalty = { points: plan.points, value: plan.value };
        if (plan.reason) warnings.push({ code: 'POINTS_ADJUSTED', message: `We applied ${plan.points} points, the most you can use on this order.` });
      } else {
        warnings.push({
          code: 'POINTS_REJECTED',
          message: plan.reason === 'balance' ? 'You do not have enough points yet.' : `You can spend points from ${restaurant.loyalty.minRedeem} upwards.`,
        });
      }
    }
  }

  const totals = computeTotals({ subtotal, discount, loyaltyDiscount: loyalty?.value ?? 0, fulfillment, freeDelivery, restaurant });
  return {
    ok: issues.length === 0 && lines.length > 0,
    fulfillment,
    lines,
    totals,
    coupon,
    loyalty,
    issues,
    warnings,
    rules: {
      minOrder: restaurant.delivery.minOrder,
      freeDeliveryOver: restaurant.delivery.freeOver,
      taxLabel: restaurant.taxLabel,
      taxRate: restaurant.taxRate,
      serviceChargeRate: restaurant.serviceChargeRate,
      pointValue: restaurant.loyalty.pointValue,
      minRedeem: restaurant.loyalty.minRedeem,
    },
  };
}
