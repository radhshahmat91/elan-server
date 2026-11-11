// Demo order history: about six weeks of orders, their payments, the loyalty wallet that follows from them, and a set of
// "live" orders in every kitchen state so the kitchen, rider and admin screens are never empty.
//
// Pure and deterministic: nothing here touches the database. Prices come from the same priceLine() / computeTotals() the
// checkout uses, coupons from evaluateCouponRules(), and points from tierFor() / pointsForTotal(), so the sample data
// obeys exactly the rules the live system enforces.
import { evaluateCouponRules } from '../../services/couponService.js';
import { ingredientNeeds } from '../../services/inventoryService.js';
import { pointsForTotal, tierFor } from '../../services/loyaltyService.js';
import { computeTotals, planRedemption, priceLine } from '../../services/pricingService.js';
import { addDays, dateKey, weekdayOf } from '../../utils/dates.js';
import { GUESTS, ITEM_NOTES, ORDER_NOTES } from '../data/stories.js';
import { DIGITS, LOWER, MIN, ALNUM, addMinutes, clamp, hmToMinutes, localAt, localMinutes } from './helpers.js';

const GATEWAY = { name: 'Payment gateway', role: 'system' };
const LIFETIME_TYPES = new Set(['earn', 'bonus', 'referral', 'birthday']);
const NEUTRAL_REASONS = ['Changed my mind', 'Ordered by mistake', 'The wait was longer than I can manage tonight', 'Ordering again with the right address'];

// Orders that are still moving when the seed runs. `age` is minutes since the guest ordered.
export const LIVE_SCENARIOS = [
  { status: 'pending_payment', age: 7, fulfillment: 'delivery', customer: 'mehedi', payment: 'bkash' },
  { status: 'placed', age: 3, fulfillment: 'delivery', customer: null, payment: 'cod' },
  { status: 'placed', age: 5, fulfillment: 'dine_in', customer: 'farhan', payment: 'card', table: '4', coupon: 'TABLE15' },
  { status: 'confirmed', age: 12, fulfillment: 'pickup', customer: 'tasnim', payment: 'bkash' },
  { status: 'preparing', age: 18, fulfillment: 'delivery', customer: 'nusrat', payment: 'card' },
  { status: 'preparing', age: 24, fulfillment: 'dine_in', customer: null, payment: 'cod', table: '9' },
  { status: 'ready', age: 33, fulfillment: 'delivery', customer: 'rahim', payment: 'cod' },
  { status: 'ready', age: 36, fulfillment: 'pickup', customer: null, payment: 'card' },
  { status: 'out_for_delivery', age: 44, fulfillment: 'delivery', customer: 'sadia', payment: 'nagad', rider: 'rider2' },
];

const GUEST_ADDRESSES = [
  { line1: 'House 5, Road 104', area: 'Gulshan' },
  { line1: 'Flat 4D, House 19, Road 7', area: 'Banani' },
  { line1: 'House 88, Road 12', area: 'Baridhara' },
  { line1: 'Plot 14, Block B, Merul Badda', area: 'Badda' },
  { line1: 'Flat 2A, 31 Satmasjid Road', area: 'Dhanmondi' },
  { line1: 'House 9, Sector 11', area: 'Uttara' },
];

const categoryKey = (item) => {
  const slug = item.category?.slug;
  if (slug) return slug;
  const name = String(item.category?.name ?? '').toLowerCase();
  return name.startsWith('breakfast') ? 'breakfast' : name;
};

/**
 * @param {object} input
 * @param {Date} input.now
 * @param {ReturnType<import('../random.js').createRandom>} input.rand
 * @param {(date?: Date) => string} input.nextId
 * @param {object} input.restaurant                 the settings document (hours, delivery, tax, loyalty)
 * @param {object[]} input.menu                     menu items with optionGroups and category populated
 * @param {object[]} input.tables                   table documents
 * @param {Map<string, object>} input.coupons       code -> coupon document
 * @param {Record<string, object>} input.staff      owner, manager, chef, rider, rider2 (user documents)
 * @param {object[]} input.customers                [{ _id, name, email, phone, createdAt, profile: { key, weight, addresses, referredBy } }]
 */
export function generateOrders({ now, rand, nextId, restaurant, menu, tables, coupons, staff, customers, days = 45 }) {
  const tiers = restaurant.loyalty.tiers;
  const sellable = menu.filter((m) => m.available !== false && !m.archived);
  const byCategory = new Map();
  for (const item of sellable) {
    const key = categoryKey(item);
    if (!byCategory.has(key)) byCategory.set(key, []);
    byCategory.get(key).push(item);
  }
  const menuById = new Map(menu.map((m) => [String(m._id), m]));
  const customerByKey = new Map(customers.map((c) => [c.profile.key, c]));
  const qrTables = tables.filter((t) => t.active !== false && t.section !== 'private');

  const orders = [];
  const payments = [];
  const ledger = [];
  const wallets = new Map();
  const couponUse = new Map();
  const sold = new Map();
  const stockUsage = [];
  const pending = [];
  const usedPublicIds = new Set();
  const usedNumbers = new Set();

  // ------------------------------------------------------------------------------------------ loyalty wallet
  const walletOf = (user) => {
    const key = String(user._id);
    if (!wallets.has(key)) wallets.set(key, { points: 0, lifetime: 0, tier: tiers[0].key, orders: 0, referralRewarded: false, couponUses: {} });
    return wallets.get(key);
  };
  function grant(user, type, points, at, extra = {}) {
    const wallet = walletOf(user);
    wallet.points += points;
    if (points > 0 && LIFETIME_TYPES.has(type)) wallet.lifetime += points;
    wallet.tier = tierFor(wallet.lifetime, tiers).key;
    ledger.push({ user: user._id, type, points, balanceAfter: wallet.points, ...extra, createdAt: at, updatedAt: at });
  }
  const queue = (at, run) => pending.push({ at, run });
  function flush(until) {
    pending.sort((a, b) => a.at - b.at);
    while (pending.length && pending[0].at <= until) pending.shift().run();
  }

  for (const customer of customers) {
    queue(customer.createdAt, () => grant(customer, 'bonus', restaurant.loyalty.signupBonus, customer.createdAt, { note: 'Welcome bonus' }));
  }
  const goodwillAt = addMinutes(localAt(addDays(dateKey(now), -14), 0), 15 * 60 + 40);
  if (customerByKey.has('nusrat')) {
    queue(goodwillAt, () => grant(customerByKey.get('nusrat'), 'adjust', 100, goodwillAt, { note: 'Goodwill points after a late delivery', createdBy: staff.manager._id }));
  }

  // ------------------------------------------------------------------------------------------ small pickers
  const unique = (set, make) => {
    for (let i = 0; i < 50; i += 1) {
      const value = make();
      if (!set.has(value)) {
        set.add(value);
        return value;
      }
    }
    throw new Error('Could not generate a unique identifier for the demo data.');
  };

  const dishWeight = (d) => 1 + (d.featured ? 1.5 : 0) + (d.tags?.includes('signature') ? 0.8 : 0) + (d.salePrice != null ? 0.4 : 0) - ((d.salePrice ?? d.price) > 2000 ? 0.4 : 0);

  function pickSelections(item) {
    const out = [];
    for (const group of item.optionGroups ?? []) {
      const choices = (group.choices ?? []).filter((c) => c.available !== false);
      if (choices.length === 0) continue;
      const required = group.isRequired || (group.minSelect ?? 0) >= 1;
      if (required) {
        const need = Math.max(1, group.minSelect ?? 1);
        const picks = new Set();
        const fallback = choices.find((c) => c.isDefault);
        if (fallback && rand.chance(0.6)) picks.add(fallback.key);
        while (picks.size < need) picks.add(rand.pick(choices).key);
        out.push({ group: group.key, choices: [...picks] });
      } else if (rand.chance(0.3)) {
        const count = Math.min(group.maxSelect ?? 1, choices.length, rand.chance(0.7) ? 1 : 2);
        out.push({ group: group.key, choices: rand.sample(choices, count).map((c) => c.key) });
      }
    }
    return out;
  }

  function addLine(lines, item, quantity) {
    const note = rand.chance(0.05) ? rand.pick(ITEM_NOTES) : undefined;
    const { line, issues } = priceLine(item, { quantity, selections: pickSelections(item), note });
    if (issues.length) throw new Error(`The demo generator built an invalid cart line for ${item.slug}: ${JSON.stringify(issues)}`);
    lines.push(line);
  }

  function chooseLines({ fulfillment, minute, target }) {
    const count = fulfillment === 'dine_in' ? rand.int(2, 4) : fulfillment === 'pickup' ? rand.weighted([[1, 50], [2, 38], [3, 12]]) : rand.weighted([[1, 38], [2, 38], [3, 20], [4, 4]]);
    const lines = [];
    const chosen = new Set();
    const categoryWeights = [['mains', 44], ['starters', 20], ['desserts', 12], ['drinks', 18], ['breakfast', minute < 15 * 60 ? 14 : 5]];
    const take = () => {
      for (let attempt = 0; attempt < 12; attempt += 1) {
        const options = (byCategory.get(rand.weighted(categoryWeights)) ?? []).filter((d) => !chosen.has(d.slug));
        if (options.length === 0) continue;
        const item = rand.weighted(options.map((d) => [d, dishWeight(d)]));
        chosen.add(item.slug);
        addLine(lines, item, rand.weighted([[1, 78], [2, 19], [3, 3]]));
        return true;
      }
      return false;
    };
    for (let i = 0; i < count; i += 1) take();
    let subtotal = lines.reduce((sum, l) => sum + l.lineTotal, 0);
    while (subtotal < target && lines.length < 7 && take()) subtotal = lines.reduce((sum, l) => sum + l.lineTotal, 0);
    // Still short (a very small basket): add a second portion of the first line.
    if (subtotal < target && lines.length) {
      const first = lines[0];
      first.quantity += 1;
      first.lineTotal = first.unitPrice * first.quantity;
      subtotal = lines.reduce((sum, l) => sum + l.lineTotal, 0);
    }
    return { lines, subtotal };
  }

  // ------------------------------------------------------------------------------------------ one order
  function buildOrder({ placedAt, scenario = null }) {
    flush(placedAt);
    const minute = localMinutes(placedAt);
    const fulfillment = scenario?.fulfillment ?? rand.weighted([['delivery', 52], ['pickup', 20], ['dine_in', 28]]);

    // Who is ordering.
    let user = null;
    if (scenario) {
      user = scenario.customer ? customerByKey.get(scenario.customer) ?? null : null;
    } else {
      const eligible = customers.filter((c) => c.profile.weight > 0 && c.createdAt.getTime() <= placedAt.getTime() - 86_400_000);
      if (eligible.length && rand.chance(0.5)) user = rand.weighted(eligible.map((c) => [c, c.profile.weight]));
    }
    const guest = user ? null : rand.pick(GUESTS);
    const customer = user ? { name: user.name, phone: user.phone, email: user.email } : { name: guest.name, phone: guest.phone, email: guest.email };
    const wallet = user ? walletOf(user) : null;

    // Where it goes.
    let address;
    let tableNumber;
    if (fulfillment === 'delivery') {
      const saved = user ? rand.pick(user.profile.addresses) : null;
      const base = saved ?? rand.pick(GUEST_ADDRESSES);
      address = { label: saved?.label ?? 'Home', recipient: customer.name, line1: base.line1, area: base.area, city: 'Dhaka', notes: saved?.notes ?? (rand.chance(0.12) ? rand.pick(ORDER_NOTES) : undefined) };
    } else if (fulfillment === 'dine_in') {
      tableNumber = scenario?.table ?? rand.pick(qrTables).number;
    }

    // What they ordered.
    const couponCode = scenario?.coupon ?? null;
    const couponDoc = couponCode ? coupons.get(couponCode) : null;
    const target = Math.max(fulfillment === 'delivery' ? restaurant.delivery.minOrder : 0, couponDoc?.minOrder ?? 0);
    const { lines, subtotal } = chooseLines({ fulfillment, minute, target });

    // Coupon (signed-in guests only), then loyalty points.
    let coupon;
    let discount = 0;
    let freeDelivery = false;
    const baseFee = fulfillment === 'delivery' && subtotal < restaurant.delivery.freeOver ? restaurant.delivery.baseFee : 0;
    const tryCoupon = (code) => {
      const doc = coupons.get(code);
      if (!doc || !user) return false;
      const verdict = evaluateCouponRules(doc, { subtotal, deliveryFee: baseFee, fulfillment, userUses: wallet.couponUses[code] ?? 0, isFirstOrder: wallet.orders === 0, signedIn: true }, placedAt);
      if (!verdict.valid) return false;
      coupon = { code, description: doc.description, discount: verdict.discount, couponId: doc._id };
      discount = verdict.freeDelivery ? 0 : verdict.discount;
      freeDelivery = verdict.freeDelivery;
      return true;
    };
    if (scenario) {
      if (couponCode) tryCoupon(couponCode);
    } else if (user) {
      if (wallet.orders === 0 && rand.chance(0.7)) tryCoupon('WELCOME10');
      if (!coupon && fulfillment === 'dine_in' && rand.chance(0.5)) tryCoupon('TABLE15');
      if (!coupon && fulfillment === 'delivery' && baseFee > 0 && rand.chance(0.35)) tryCoupon('FREESHIP');
      if (!coupon && rand.chance(0.12)) tryCoupon('BRUNCH100');
    }

    let loyalty = { points: 0, value: 0 };
    if (user && !scenario && wallet.points >= restaurant.loyalty.minRedeem && rand.chance(0.22)) {
      const requested = rand.pick([100, 200, 300, 500, 800]);
      const plan = planRedemption({ requested, balance: wallet.points, minRedeem: restaurant.loyalty.minRedeem, pointValue: restaurant.loyalty.pointValue, cap: subtotal - discount });
      if (plan.points > 0) loyalty = { points: plan.points, value: plan.value };
    }

    const totals = computeTotals({ subtotal, discount, loyaltyDiscount: loyalty.value, fulfillment, freeDelivery, restaurant });

    // Payment method.
    const method = scenario?.payment ?? rand.weighted(fulfillment === 'dine_in' ? [['cod', 60], ['card', 25], ['bkash', 15]] : [['cod', 38], ['card', 25], ['bkash', 27], ['nagad', 10]]);
    const online = method !== 'cod';

    // How it ended.
    let outcome = scenario?.status ?? rand.weighted([['delivered', 89], ['cancelled', 7], ['rejected', 2], ['abandoned', 2]]);
    if (outcome === 'abandoned' && !online) outcome = 'delivered';

    const prepMax = Math.max(...lines.map((l) => l.prepMinutes ?? 12));
    const rider = scenario?.rider ? staff[scenario.rider] : rand.chance(0.6) ? staff.rider : staff.rider2;
    const times = {};
    const age = scenario ? scenario.age : 0;
    if (scenario) {
      const at = (share) => addMinutes(placedAt, Math.max(1, Math.round(share * age)));
      Object.assign(times, { placed: placedAt, confirmed: at(0.08), preparing: at(0.2), ready: at(0.6), out_for_delivery: at(0.75) });
    } else {
      times.placed = placedAt;
      times.confirmed = addMinutes(placedAt, rand.int(1, 4));
      times.preparing = addMinutes(times.confirmed, rand.int(2, 7));
      times.ready = addMinutes(times.preparing, prepMax + rand.int(0, 6));
      if (fulfillment === 'delivery') {
        times.out_for_delivery = addMinutes(times.ready, rand.int(2, 8));
        times.delivered = addMinutes(times.out_for_delivery, rand.int(14, 34));
      } else {
        times.delivered = addMinutes(times.ready, fulfillment === 'pickup' ? rand.int(3, 18) : rand.int(1, 4));
      }
    }
    const pendingAt = online ? addMinutes(placedAt, scenario?.status === 'pending_payment' ? 0 : -rand.int(2, 4)) : null;

    const orderId = nextId(pendingAt ?? placedAt);
    const publicId = unique(usedPublicIds, () => rand.code(LOWER, 14));
    const stamp = placedAt;
    const orderNumber = unique(usedNumbers, () => `EL-${String(stamp.getUTCFullYear()).slice(2)}${String(stamp.getUTCMonth() + 1).padStart(2, '0')}${String(stamp.getUTCDate()).padStart(2, '0')}-${rand.code(DIGITS, 4)}`);

    const customerActor = user ? { id: user._id, name: user.name, role: 'customer' } : { name: 'Guest', role: 'guest' };
    const chefActor = { id: staff.chef._id, name: staff.chef.name, role: 'chef' };
    const managerActor = { id: staff.manager._id, name: staff.manager.name, role: 'manager' };
    const riderActor = { id: rider._id, name: rider.name, role: 'delivery' };
    const history = [];
    const note = (status, at, by, text) => history.push({ status, at, by, note: text });

    const order = {
      _id: orderId,
      publicId,
      orderNumber,
      user: user?._id ?? null,
      customer,
      fulfillment,
      address,
      tableNumber,
      source: fulfillment === 'dine_in' ? 'qr' : 'web',
      items: lines,
      totals,
      coupon,
      loyaltyRedeemed: { points: loyalty.points, value: loyalty.value },
      payment: { method, status: online ? 'pending' : 'cash_due', provider: online ? 'sandbox' : 'cod' },
      statusHistory: history,
      assignedDelivery: null,
      etaAt: addMinutes(placedAt, (fulfillment === 'delivery' ? restaurant.delivery : fulfillment === 'pickup' ? restaurant.pickup : restaurant.dineIn).etaMinutes),
      stockDeducted: false,
      loyaltyAwarded: false,
      loyaltyRefunded: false,
      couponRecorded: Boolean(coupon),
      isDemo: true,
    };
    if (fulfillment === 'delivery' && !scenario && rand.chance(0.05)) order.notes = rand.pick(ORDER_NOTES);

    // ---- the payment document
    let payment = null;
    const paymentId = online ? nextId(pendingAt) : null;
    if (online) {
      payment = {
        _id: paymentId,
        order: orderId,
        user: user?._id ?? null,
        provider: 'sandbox',
        method,
        amount: totals.total,
        currency: restaurant.currency ?? 'BDT',
        status: 'pending',
        sessionId: `sbx_${rand.code(ALNUM, 24)}`,
        sessionExpiresAt: addMinutes(pendingAt, 30),
        events: [],
        refunds: [],
        createdAt: pendingAt,
        updatedAt: pendingAt,
      };
      order.payment.paymentId = paymentId;
      note('pending_payment', pendingAt, customerActor, 'Waiting for payment');
    }

    const paid = (at) => {
      order.payment.status = 'paid';
      order.payment.paidAt = at;
      payment.status = 'succeeded';
      payment.providerTxnId = `sbxtx_${rand.code(ALNUM, 11)}`;
      payment.events.push({ eventId: `evt_${rand.code(ALNUM, 12)}`, type: 'payment.succeeded', at, amount: totals.total, currency: payment.currency, verified: true });
      payment.updatedAt = at;
    };
    const refund = (at, amount, reason, by) => {
      payment.refunds.push({ amount, reason, by, at });
      payment.status = amount >= totals.total ? 'refunded' : 'partially_refunded';
      payment.updatedAt = at;
      order.payment.status = payment.status;
      order.payment.refundedTotal = (order.payment.refundedTotal ?? 0) + amount;
    };

    // ---- the story
    if (outcome === 'pending_payment') {
      order.status = 'pending_payment';
      order.placedAt = undefined;
      order.createdAt = pendingAt;
      order.updatedAt = pendingAt;
    } else if (outcome === 'abandoned') {
      const failedAt = addMinutes(pendingAt, rand.int(1, 3));
      const attempted = rand.chance(0.5);
      if (attempted) {
        payment.events.push({ eventId: `evt_${rand.code(ALNUM, 12)}`, type: 'payment.failed', at: failedAt, amount: totals.total, currency: payment.currency, verified: true });
        order.payment.status = 'failed';
      }
      const closedAt = addMinutes(pendingAt, 31);
      payment.status = 'cancelled';
      payment.updatedAt = closedAt;
      note('cancelled', closedAt, { name: 'System', role: 'system' }, 'Payment was not completed in time');
      order.status = 'cancelled';
      order.cancellation = { reason: 'Payment window expired', by: 'system' };
      order.placedAt = undefined;
      order.createdAt = pendingAt;
      order.updatedAt = closedAt;
      order.couponRecorded = false;
      if (user && loyalty.points > 0) {
        order.loyaltyRefunded = true;
        queue(closedAt, () => grant(user, 'refund', loyalty.points, closedAt, { order: orderId, note: `Points returned for order ${orderNumber}` }));
      }
    } else {
      order.placedAt = placedAt;
      order.createdAt = pendingAt ?? placedAt;
      if (online) {
        paid(placedAt);
        note('placed', placedAt, GATEWAY, 'Payment confirmed');
      } else {
        note('placed', placedAt, customerActor, 'Order placed, pay on delivery');
      }
      order.status = 'placed';
      let last = placedAt;

      if (outcome === 'cancelled' || outcome === 'rejected') {
        const fromConfirmed = outcome === 'cancelled' && rand.chance(0.3);
        let at = addMinutes(placedAt, rand.int(2, 9));
        if (fromConfirmed || outcome === 'rejected') {
          if (fromConfirmed) {
            order.confirmedAt = times.confirmed;
            note('confirmed', times.confirmed, rand.chance(0.75) ? chefActor : managerActor);
            order.status = 'confirmed';
            at = addMinutes(times.confirmed, rand.int(2, 8));
          }
        }
        const byCustomer = outcome === 'cancelled' && !fromConfirmed && rand.chance(0.65);
        const actor = outcome === 'rejected' ? chefActor : byCustomer ? customerActor : managerActor;
        const reason = outcome === 'rejected' ? 'The kitchen is out of an ingredient for one dish' : byCustomer ? rand.pick(NEUTRAL_REASONS) : 'Guest asked us to cancel by phone';
        note(outcome, at, actor, reason);
        order.status = outcome;
        order.cancellation = { reason, by: actor.role };
        order.couponRecorded = false;
        last = at;
        if (online) refund(at, totals.total, `Order ${outcome}`, { id: actor.id, name: actor.name });
        if (user && loyalty.points > 0) {
          order.loyaltyRefunded = true;
          queue(at, () => grant(user, 'refund', loyalty.points, at, { order: orderId, note: `Points returned for order ${orderNumber}` }));
        }
        order.updatedAt = last;
      } else {
        const reached = scenario ? scenario.status : 'delivered';
        const chain = ['confirmed', 'preparing', 'ready'];
        if (fulfillment === 'delivery') chain.push('out_for_delivery');
        chain.push('delivered');
        const stopAt = chain.indexOf(reached);
        const actors = { confirmed: rand.chance(0.75) ? chefActor : managerActor, preparing: chefActor, ready: chefActor, out_for_delivery: riderActor, delivered: fulfillment === 'delivery' ? riderActor : chefActor };
        const fields = { confirmed: 'confirmedAt', preparing: 'preparingAt', ready: 'readyAt', delivered: 'deliveredAt' };
        for (let i = 0; i <= stopAt; i += 1) {
          const status = chain[i];
          note(status, times[status], actors[status]);
          if (fields[status]) order[fields[status]] = times[status];
          order.status = status;
          last = times[status];
        }
        order.updatedAt = last;
        if (order.status === 'out_for_delivery' || (fulfillment === 'delivery' && order.status === 'delivered')) order.assignedDelivery = rider._id;
        if (order.preparingAt) order.stockDeducted = true;
        if (order.status === 'delivered') {
          if (!online) {
            order.payment.status = 'paid';
            order.payment.paidAt = last;
          }
          if (user) {
            order.loyaltyAwarded = true;
            queue(last, () => {
              const tier = tierFor(wallet.lifetime, tiers);
              const points = pointsForTotal(totals.total, restaurant.loyalty.earnPerTaka, tier);
              if (points > 0) grant(user, 'earn', points, last, { order: orderId, note: `Order ${orderNumber}` });
              const profile = user.profile;
              if (profile.referredBy && !wallet.referralRewarded) {
                wallet.referralRewarded = true;
                const referrer = customerByKey.get(profile.referredBy);
                if (referrer) grant(referrer, 'referral', restaurant.loyalty.referralBonus, last, { order: orderId, note: `Referral bonus: ${user.name} placed their first order` });
              }
            });
          }
          for (const line of lines) sold.set(String(line.menuItem), (sold.get(String(line.menuItem)) ?? 0) + line.quantity);
        }
      }
    }

    // Redeemed points leave the wallet when the order is placed (and come back above if it never completes).
    if (user && loyalty.points > 0) grant(user, 'redeem', -loyalty.points, placedAt, { order: orderId, note: 'Redeemed at checkout' });

    // Bookkeeping for the next orders.
    const final = order.status;
    if (user && final !== 'cancelled' && final !== 'rejected') wallet.orders += 1;
    if (coupon && order.couponRecorded) {
      wallet.couponUses[coupon.code] = (wallet.couponUses[coupon.code] ?? 0) + 1;
      if (!couponUse.has(coupon.code)) couponUse.set(coupon.code, []);
      couponUse.get(coupon.code).push({ user: user._id, order: orderId, at: placedAt });
    }
    if (order.preparingAt) {
      stockUsage.push({ orderId, orderNumber, at: order.preparingAt, needs: ingredientNeeds(lines, menuById), by: { id: chefActor.id, name: chefActor.name } });
    }
    if (payment) payments.push(payment);
    orders.push(order);
    return order;
  }

  // ------------------------------------------------------------------------------------------ the calendar
  const today = dateKey(now);
  const planned = [];
  for (let offset = days; offset >= 0; offset -= 1) {
    const key = addDays(today, -offset);
    const weekday = weekdayOf(key);
    const hours = restaurant.hours.find((h) => h.day === weekday);
    if (!hours || hours.closed) continue;
    const open = hmToMinutes(hours.open);
    const close = hmToMinutes(hours.close);
    const progress = (days - offset) / days;
    const base = [3, 2, 2, 3, 3, 6, 7][weekday];
    const count = Math.max(1, Math.round(base * (0.75 + 0.5 * progress)) + rand.int(-1, 1));
    for (let i = 0; i < count; i += 1) {
      const bucket = rand.weighted([['lunch', 38], ['dinner', 50], ['other', 12]]);
      const raw = bucket === 'lunch' ? rand.int(12 * 60 + 10, 14 * 60 + 40) : bucket === 'dinner' ? rand.int(19 * 60, 21 * 60 + 45) : rand.int(open + 20, close - 50);
      const placedAt = localAt(key, clamp(raw, open + 10, close - 45));
      if (placedAt.getTime() > now.getTime() - 90 * MIN) continue; // leave the last hour and a half to the live orders
      planned.push(placedAt);
    }
  }
  planned.sort((a, b) => a - b);
  for (const placedAt of planned) buildOrder({ placedAt });
  for (const scenario of [...LIVE_SCENARIOS].sort((a, b) => b.age - a.age)) buildOrder({ placedAt: addMinutes(now, -scenario.age), scenario });
  flush(new Date(now.getTime() + 365 * 86_400_000));

  // One delivered, online-paid order from about nine days ago gets a goodwill refund: the "partially refunded" state.
  const nineDays = 9 * 86_400_000;
  const candidates = orders
    .filter((o) => o.status === 'delivered' && o.payment.status === 'paid' && o.payment.provider === 'sandbox' && o.user && o.totals.total >= 1200)
    .filter((o) => now - o.deliveredAt >= 6 * 86_400_000 && now - o.deliveredAt <= 20 * 86_400_000)
    .sort((a, b) => Math.abs(now - a.deliveredAt - nineDays) - Math.abs(now - b.deliveredAt - nineDays));
  let partialRefund = null;
  if (candidates.length) {
    const order = candidates[0];
    const payment = payments.find((p) => p.order === order._id);
    const at = addMinutes(order.deliveredAt, 95);
    payment.refunds.push({ amount: 300, reason: 'Arrived lukewarm: goodwill refund', by: { id: staff.manager._id, name: staff.manager.name }, at });
    payment.status = 'partially_refunded';
    payment.updatedAt = at;
    order.payment.status = 'partially_refunded';
    order.payment.refundedTotal = 300;
    order.updatedAt = at;
    partialRefund = { orderId: order._id, orderNumber: order.orderNumber, at };
  }

  ledger.sort((a, b) => a.createdAt - b.createdAt);
  return { orders, payments, ledger, wallets, couponUse, sold, stockUsage, partialRefund };
}
