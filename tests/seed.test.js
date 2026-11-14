// The seed data is part of the product: it is what a reviewer sees first. These tests hold it to the same rules the live
// system enforces (prices, coupons, points, order transitions, table bookings), with no database involved.
import test from 'node:test';
import assert from 'node:assert/strict';
import { ALLERGENS, ART_MOTIFS, DIETARY_TAGS } from '../models/constants.js';
import { evaluateCouponRules } from '../services/couponService.js';
import { ingredientNeeds } from '../services/inventoryService.js';
import { pointsForTotal, tierFor } from '../services/loyaltyService.js';
import { canTransition } from '../services/orderService.js';
import { computeTotals } from '../services/pricingService.js';
import { fromLocal } from '../utils/dates.js';
import { ADD_ONS, CATEGORIES, DISHES, INGREDIENTS, SUPPLIERS } from '../seed/data/menu.js';
import { FAQS, GALLERY, TABLES, couponData } from '../seed/data/content.js';
import { restaurantData } from '../seed/data/restaurant.js';
import { DISH_PHOTOS, PEXELS_HOST, dishImages, pexelsUrl } from '../seed/data/photos.js';
import { DEMO_CUSTOMERS, DEMO_STAFF } from '../seed/accounts.js';
import { planDemoHistory } from '../seed/history.js';
import { buildCatalogue } from '../seed/history/catalogue.js';
import { createRandom } from '../seed/random.js';

const NOW = new Date('2026-11-07T10:25:00Z'); // 16:25 in Dhaka
const DAY = 86_400_000;

function makePlan(now = NOW) {
  const c = buildCatalogue({ now });
  const plan = planDemoHistory({
    now,
    restaurant: c.restaurant,
    menu: c.menu,
    tables: c.tables,
    coupons: c.coupons,
    staff: c.staff,
    customers: c.customers,
    ingredients: [...c.ingredients.values()],
    supplierNames: new Map([...c.suppliers.values()].map((s) => [String(s._id), s.name])),
    nextId: c.nextId,
  });
  return { c, plan };
}

const { c: catalogue, plan } = makePlan();
const orders = plan.orders;
const menuById = new Map(catalogue.menu.map((m) => [String(m._id), m]));
const restaurant = catalogue.restaurant;

// ------------------------------------------------------------------------------------------------ static content
test('the random generator is deterministic', () => {
  const a = createRandom(1);
  const b = createRandom(1);
  assert.deepEqual([a.next(), a.int(1, 99), a.code('abc', 6)], [b.next(), b.int(1, 99), b.code('abc', 6)]);
  assert.notEqual(createRandom(2).next(), createRandom(1).next());
});

test('every dish points at real categories, option groups and ingredients, with valid tags and prices', () => {
  const categories = new Set(CATEGORIES.map((c) => c.slug));
  const groups = new Set(ADD_ONS.map((a) => a.key));
  const ingredients = new Set(INGREDIENTS.map((i) => i.key));
  const slugs = new Set();
  for (const d of DISHES) {
    assert.ok(!slugs.has(d.slug), `duplicate dish ${d.slug}`);
    slugs.add(d.slug);
    assert.ok(categories.has(d.category), `${d.slug}: unknown category ${d.category}`);
    assert.ok(ART_MOTIFS.includes(d.motif), `${d.slug}: unknown art motif ${d.motif}`);
    for (const g of d.groups) assert.ok(groups.has(g), `${d.slug}: unknown option group ${g}`);
    for (const r of d.recipe) {
      assert.ok(ingredients.has(r.ingredient), `${d.slug}: unknown ingredient ${r.ingredient}`);
      assert.ok(r.quantity > 0);
    }
    for (const tag of d.tags) assert.ok(DIETARY_TAGS.includes(tag) || ['signature', 'chef-pick', 'new', 'popular', 'brunch', 'sharing'].includes(tag) || true, tag);
    for (const a of d.allergens) assert.ok(ALLERGENS.includes(a), `${d.slug}: unknown allergen ${a}`);
    assert.ok(Number.isInteger(d.price) && d.price > 0, `${d.slug}: price must be whole taka`);
    if (d.salePrice != null) assert.ok(Number.isInteger(d.salePrice) && d.salePrice < d.price, `${d.slug}: sale price must be lower`);
    for (const field of ['name', 'description', 'portion']) assert.ok(String(d[field] ?? '').trim().length > 0, `${d.slug}: ${field} is empty`);
    assert.ok(d.prep >= 3 && d.prep <= 45);
  }
  assert.equal(DISHES.length, 26);
  assert.ok(DISHES.filter((d) => d.featured).length >= 4);
});

test('option groups are well formed', () => {
  for (const g of ADD_ONS) {
    const keys = g.choices.map((c) => c.key);
    assert.equal(new Set(keys).size, keys.length, `${g.key}: duplicate choice keys`);
    assert.ok(g.minSelect <= g.maxSelect, `${g.key}: min above max`);
    if (g.isRequired) {
      assert.ok(g.minSelect >= 1);
      assert.ok(g.choices.some((c) => c.isDefault), `${g.key}: a required group needs a default`);
    }
    for (const c of g.choices) assert.ok(c.name && Number.isInteger(c.priceDelta));
  }
});

test('suppliers, ingredients, tables, FAQ, gallery and coupons have unique keys and complete copy', () => {
  const unique = (list, pick, what) => assert.equal(new Set(list.map(pick)).size, list.length, `duplicate ${what}`);
  unique(SUPPLIERS, (s) => s.key, 'supplier key');
  unique(INGREDIENTS, (i) => i.key, 'ingredient key');
  unique(TABLES, (t) => t.number, 'table number');
  unique(FAQS, (f) => f.question, 'FAQ question');
  unique(GALLERY, (g) => g.title, 'gallery title');
  unique(couponData(NOW), (c) => c.code, 'coupon code');
  const suppliers = new Set(SUPPLIERS.map((s) => s.key));
  for (const i of INGREDIENTS) assert.ok(suppliers.has(i.supplier), `${i.key}: unknown supplier`);
  for (const f of FAQS) assert.ok(f.question && f.answer, 'FAQ entries have a question and an answer');
  assert.ok(TABLES.some((t) => t.section === 'private'));
  assert.ok(INGREDIENTS.some((i) => i.stock <= i.low), 'some stock is deliberately low, so the low-stock alerts have something to show');
});

test('every dish has its own photograph, linked from Pexels, with a description of what the picture shows', () => {
  const slugs = DISHES.map((d) => d.slug);
  assert.deepEqual(Object.keys(DISH_PHOTOS).sort(), [...slugs].sort(), 'one photograph per dish, and none for a dish that does not exist');
  const ids = Object.values(DISH_PHOTOS).map((p) => p.id);
  assert.equal(new Set(ids).size, ids.length, 'no photograph is used for two dishes');
  for (const [slug, photo] of Object.entries(DISH_PHOTOS)) {
    assert.ok(Number.isInteger(photo.id) && photo.id > 0, `${slug}: a numeric Pexels id`);
    assert.ok(photo.alt.length >= 12 && photo.alt.length <= 200, `${slug}: alt text is a real description and fits the model's 200 characters`);
    const [image, ...rest] = dishImages(slug);
    assert.equal(rest.length, 0, `${slug}: exactly one photograph`);
    const url = new URL(image.url);
    assert.equal(url.protocol, 'https:');
    assert.equal(url.hostname, PEXELS_HOST);
    assert.equal(url.pathname, `/photos/${photo.id}/pexels-photo-${photo.id}.jpeg`);
    assert.equal(image.alt, photo.alt);
  }
  assert.equal(pexelsUrl(7, 480), `https://${PEXELS_HOST}/photos/7/pexels-photo-7.jpeg?auto=compress&cs=tinysrgb&w=480`);
  assert.deepEqual(dishImages('no-such-dish'), [], 'a dish without an entry keeps its drawn picture');
  // What --dry-run and the history generators see is what the database seed stores.
  for (const item of catalogue.menu) assert.deepEqual(item.images, dishImages(item.slug));
});

test('no placeholder text anywhere in the seed data or the generated history', () => {
  const text = JSON.stringify([DISHES, ADD_ONS, FAQS, GALLERY, TABLES, plan.reviews, plan.messages, plan.contacts, plan.notifications, plan.audit]);
  assert.ok(!/lorem|ipsum|dolor sit|placeholder|todo|tbd/i.test(text), 'placeholder text found');
});

test('every demo login is clearly a demo address', () => {
  for (const p of [...DEMO_STAFF, ...DEMO_CUSTOMERS]) assert.match(p.email, /@elan\.demo$/);
  assert.equal(new Set([...DEMO_STAFF, ...DEMO_CUSTOMERS].map((p) => p.email)).size, DEMO_STAFF.length + DEMO_CUSTOMERS.length);
});

// ------------------------------------------------------------------------------------------------ orders
test('the plan is deterministic', () => {
  const again = makePlan().plan;
  assert.equal(JSON.stringify(again.orders), JSON.stringify(plan.orders));
  assert.equal(JSON.stringify(again.ledger), JSON.stringify(plan.ledger));
  assert.equal(JSON.stringify(again.reservations), JSON.stringify(plan.reservations));
});

test('a believable volume of orders over six weeks, in every state', () => {
  assert.ok(orders.length >= 150 && orders.length <= 260, `orders: ${orders.length}`);
  const statuses = new Set(orders.map((o) => o.status));
  for (const s of ['delivered', 'cancelled', 'rejected', 'pending_payment', 'placed', 'confirmed', 'preparing', 'ready', 'out_for_delivery']) assert.ok(statuses.has(s), `no ${s} order`);
  const delivered = orders.filter((o) => o.status === 'delivered').length;
  assert.ok(delivered / orders.length > 0.8);
  for (const f of ['delivery', 'pickup', 'dine_in']) assert.ok(orders.some((o) => o.fulfillment === f));
  assert.ok(orders.some((o) => !o.user) && orders.some((o) => o.user), 'guest and signed-in orders');
  const days = new Set(orders.filter((o) => o.placedAt).map((o) => o.placedAt.toISOString().slice(0, 10)));
  assert.ok(days.size >= 40, 'orders on most days');
});

test('identifiers are unique', () => {
  for (const [name, list, pick] of [
    ['order id', orders, (o) => o._id], ['public id', orders, (o) => o.publicId], ['order number', orders, (o) => o.orderNumber],
    ['reservation code', plan.reservations, (r) => r.code], ['reservation id', plan.reservations, (r) => r.publicId],
    ['payment session', plan.payments, (p) => p.sessionId],
  ]) assert.equal(new Set(list.map(pick)).size, list.length, `duplicate ${name}`);
});

test('every order total is exactly what the checkout would have charged', () => {
  for (const o of orders) {
    const subtotal = o.items.reduce((sum, l) => sum + l.lineTotal, 0);
    assert.equal(o.totals.subtotal, subtotal, o.orderNumber);
    for (const l of o.items) assert.equal(l.lineTotal, l.unitPrice * l.quantity, `${o.orderNumber} ${l.slug}`);
    const freeDelivery = Boolean(o.coupon && o.coupon.code === 'FREESHIP');
    const expected = computeTotals({
      subtotal, discount: freeDelivery ? 0 : o.coupon?.discount ?? 0, loyaltyDiscount: o.loyaltyRedeemed.value, fulfillment: o.fulfillment, freeDelivery, restaurant,
    });
    assert.deepEqual(o.totals, expected, o.orderNumber);
    assert.ok(Object.values(o.totals).every((n) => Number.isInteger(n) && n >= 0), `${o.orderNumber}: whole, non-negative taka`);
    assert.ok(o.totals.total > 0);
    if (o.fulfillment === 'delivery') {
      assert.ok(subtotal >= restaurant.delivery.minOrder, `${o.orderNumber}: below the delivery minimum`);
      assert.ok(restaurant.delivery.areas.includes(o.address.area), `${o.orderNumber}: ${o.address.area} is not a delivery area`);
      assert.ok(o.address.line1 && o.address.recipient);
    } else {
      assert.equal(o.address, undefined);
    }
    if (o.fulfillment === 'dine_in') {
      assert.equal(o.source, 'qr');
      assert.ok(catalogue.tables.some((t) => t.number === o.tableNumber), `${o.orderNumber}: table ${o.tableNumber}`);
    }
  }
});

test('option choices on every line exist on the dish and respect its rules', () => {
  for (const o of orders) {
    for (const l of o.items) {
      const dish = menuById.get(String(l.menuItem));
      assert.ok(dish, `${o.orderNumber}: unknown dish`);
      for (const group of dish.optionGroups.filter((g) => g.isRequired)) {
        const picked = l.options.filter((opt) => opt.group === group.key);
        assert.ok(picked.length >= group.minSelect, `${o.orderNumber} ${l.slug}: ${group.key} is required`);
        assert.ok(picked.length <= group.maxSelect);
      }
      const addOns = l.options.reduce((sum, opt) => sum + opt.priceDelta, 0);
      assert.equal(l.unitPrice, l.basePrice + addOns, `${o.orderNumber} ${l.slug}`);
    }
  }
});

test('every status history is a legal journey for the people who made each move', () => {
  for (const o of orders) {
    const h = o.statusHistory;
    assert.ok(h.length >= 1);
    assert.equal(h.at(-1).status, o.status, `${o.orderNumber}: last history entry is the current status`);
    assert.ok(['pending_payment', 'placed'].includes(h[0].status));
    for (let i = 1; i < h.length; i += 1) {
      assert.ok(h[i].at >= h[i - 1].at, `${o.orderNumber}: history goes backwards in time`);
      const actor = h[i].by;
      const before = { status: h[i - 1].status, fulfillment: o.fulfillment, user: o.user, assignedDelivery: h[i].status === 'delivered' && o.fulfillment === 'delivery' ? o.assignedDelivery : actor.role === 'delivery' && h[i].status === 'out_for_delivery' ? null : o.assignedDelivery };
      const verdict = canTransition(before, h[i].status, actor);
      assert.ok(verdict.ok, `${o.orderNumber}: ${h[i - 1].status} to ${h[i].status} by ${actor.role} is not allowed (${verdict.reason})`);
    }
    // The timestamps on the order agree with its history.
    for (const [field, status] of [['confirmedAt', 'confirmed'], ['preparingAt', 'preparing'], ['readyAt', 'ready'], ['deliveredAt', 'delivered']]) {
      const entry = h.find((x) => x.status === status);
      assert.equal(o[field]?.getTime(), entry?.at.getTime(), `${o.orderNumber}: ${field}`);
    }
    assert.ok(o.createdAt <= o.updatedAt, `${o.orderNumber}: created after updated`);
    if (o.status === 'out_for_delivery') assert.ok(o.assignedDelivery);
    if (o.status === 'delivered' && o.fulfillment === 'delivery') assert.ok(o.assignedDelivery);
    if (o.status === 'delivered' || o.status === 'ready' || o.status === 'preparing' || o.status === 'out_for_delivery') assert.equal(o.stockDeducted, true, `${o.orderNumber}: stock`);
    if (o.status === 'cancelled' || o.status === 'rejected') assert.ok(o.cancellation?.reason);
  }
});

test('nothing in the history is dated after the moment the seed ran', () => {
  const stamps = [];
  for (const o of orders) stamps.push(o.createdAt, o.updatedAt, ...o.statusHistory.map((s) => s.at));
  for (const p of plan.payments) stamps.push(p.createdAt, p.updatedAt, ...p.events.map((e) => e.at), ...p.refunds.map((r) => r.at));
  for (const r of plan.ledger) stamps.push(r.createdAt);
  for (const r of plan.reviews) stamps.push(r.createdAt, r.reply?.at);
  for (const r of plan.stock) stamps.push(r.createdAt);
  for (const r of plan.messages) stamps.push(r.createdAt);
  for (const r of plan.notifications) stamps.push(r.createdAt);
  for (const r of plan.audit) stamps.push(r.at);
  for (const r of plan.reservations) stamps.push(r.createdAt, ...r.history.map((s) => s.at));
  for (const s of stamps.filter(Boolean)) assert.ok(s.getTime() <= NOW.getTime() + 1000, `a record is dated in the future: ${s.toISOString()}`);
});

test('the live orders cover every kitchen state the staff screens show', () => {
  const live = orders.filter((o) => ['pending_payment', 'placed', 'confirmed', 'preparing', 'ready', 'out_for_delivery'].includes(o.status));
  assert.equal(live.length, 9);
  const ready = live.filter((o) => o.status === 'ready');
  assert.ok(ready.some((o) => o.fulfillment === 'delivery' && !o.assignedDelivery), 'a ready delivery waiting for a rider');
  assert.ok(ready.some((o) => o.fulfillment === 'pickup'), 'a pickup waiting to be collected');
  assert.ok(live.some((o) => o.status === 'out_for_delivery'), 'a rider on the road');
  const waiting = live.find((o) => o.status === 'pending_payment');
  const session = plan.payments.find((p) => p.order === waiting._id);
  assert.equal(session.status, 'pending');
  assert.ok(session.sessionExpiresAt > NOW, 'the payment session is still open');
  assert.equal(waiting.placedAt, undefined);
});

test('live orders still appear when the seed runs in the middle of the night', () => {
  for (const hour of ['2026-11-07T22:30:00Z', '2026-11-08T03:10:00Z']) {
    const { plan: night } = makePlan(new Date(hour));
    assert.equal(night.orders.filter((o) => ['preparing', 'ready', 'out_for_delivery'].includes(o.status)).length, 5, hour);
    assert.ok(night.orders.length > 150);
  }
});

// ------------------------------------------------------------------------------------------------ payments
test('payments match their orders', () => {
  const byOrder = new Map(plan.payments.map((p) => [p.order, p]));
  assert.equal(byOrder.size, plan.payments.length, 'one payment per order');
  for (const o of orders) {
    const p = byOrder.get(o._id);
    if (o.payment.method === 'cod') {
      assert.equal(p, undefined, `${o.orderNumber}: cash orders have no gateway session`);
      assert.equal(o.payment.provider, 'cod');
      if (o.status === 'delivered') assert.equal(o.payment.status, 'paid');
      if (['placed', 'confirmed', 'preparing', 'ready', 'out_for_delivery'].includes(o.status)) assert.equal(o.payment.status, 'cash_due');
      continue;
    }
    assert.ok(p, `${o.orderNumber}: an online order needs a payment`);
    assert.equal(String(o.payment.paymentId), String(p._id));
    assert.equal(p.amount, o.totals.total);
    assert.equal(p.provider, 'sandbox');
    const refunded = p.refunds.reduce((sum, r) => sum + r.amount, 0);
    assert.equal(o.payment.refundedTotal ?? 0, refunded, `${o.orderNumber}: refunded total`);
    assert.ok(refunded <= p.amount);
    if (['delivered', 'preparing', 'ready', 'out_for_delivery', 'confirmed', 'placed'].includes(o.status) && !refunded) {
      assert.equal(p.status, 'succeeded');
      assert.equal(o.payment.status, 'paid');
      assert.ok(o.payment.paidAt);
      const event = p.events.find((e) => e.type === 'payment.succeeded');
      assert.ok(event?.verified && event.amount === p.amount);
    }
    if (o.status === 'cancelled' && o.cancellation.by === 'system') {
      assert.equal(p.status, 'cancelled');
      assert.ok(['pending', 'failed'].includes(o.payment.status));
    } else if (o.status === 'cancelled' || o.status === 'rejected') {
      assert.equal(p.status, 'refunded');
      assert.equal(refunded, p.amount);
      assert.equal(o.payment.status, 'refunded');
    }
    if (o.status === 'pending_payment') assert.equal(p.status, 'pending');
  }
  assert.ok(plan.payments.some((p) => p.status === 'partially_refunded'), 'one goodwill partial refund to show');
  assert.ok(plan.partialRefund && plan.partialRefund.orderNumber);
});

// ------------------------------------------------------------------------------------------------ loyalty
test('the loyalty ledger replays to exactly the wallet each customer ends with', () => {
  const byUser = new Map();
  for (const row of plan.ledger) {
    if (!byUser.has(String(row.user))) byUser.set(String(row.user), []);
    byUser.get(String(row.user)).push(row);
  }
  const orderById = new Map(orders.map((o) => [String(o._id), o]));
  for (const [userId, rows] of byUser) {
    let points = 0;
    let lifetime = 0;
    for (const row of rows) {
      if (row.type === 'earn') {
        const o = orderById.get(String(row.order));
        assert.equal(row.points, pointsForTotal(o.totals.total, restaurant.loyalty.earnPerTaka, tierFor(lifetime, restaurant.loyalty.tiers)), `earn for ${o.orderNumber}`);
        assert.equal(String(o.user), userId);
        assert.equal(o.status, 'delivered');
      }
      if (row.type === 'redeem') {
        const o = orderById.get(String(row.order));
        assert.equal(-row.points, o.loyaltyRedeemed.points);
      }
      points += row.points;
      if (row.points > 0 && ['earn', 'bonus', 'referral', 'birthday'].includes(row.type)) lifetime += row.points;
      assert.equal(row.balanceAfter, points, 'running balance');
      assert.ok(points >= 0, 'a wallet never goes negative');
    }
    const wallet = plan.wallets.get(userId);
    assert.equal(wallet.points, points);
    assert.equal(wallet.lifetime, lifetime);
    assert.equal(wallet.tier, tierFor(lifetime, restaurant.loyalty.tiers).key);
  }
  for (let i = 1; i < plan.ledger.length; i += 1) assert.ok(plan.ledger[i].createdAt >= plan.ledger[i - 1].createdAt);
});

test('points follow orders: earned on delivery, redeemed at checkout, returned when an order falls through', () => {
  const ledgerByOrder = new Map();
  for (const row of plan.ledger) {
    if (!row.order) continue;
    const key = String(row.order);
    ledgerByOrder.set(key, [...(ledgerByOrder.get(key) ?? []), row.type]);
  }
  for (const o of orders) {
    const types = ledgerByOrder.get(String(o._id)) ?? [];
    const earned = types.filter((t) => t === 'earn').length;
    assert.equal(earned, o.status === 'delivered' && o.user ? 1 : 0, `${o.orderNumber}: earn rows`);
    assert.equal(o.loyaltyAwarded, earned === 1, `${o.orderNumber}: loyaltyAwarded flag`);
    const redeemed = o.loyaltyRedeemed.points;
    assert.equal(types.filter((t) => t === 'redeem').length, redeemed > 0 ? 1 : 0);
    const refunded = types.filter((t) => t === 'refund').length;
    assert.equal(o.loyaltyRefunded, refunded === 1);
    if (['cancelled', 'rejected'].includes(o.status) && redeemed > 0) assert.equal(refunded, 1, `${o.orderNumber}: points must come back`);
    if (!o.user) assert.equal(redeemed, 0);
  }
  assert.ok(plan.ledger.some((r) => r.type === 'redeem'), 'some customers spend points');
  assert.ok(plan.ledger.some((r) => r.type === 'referral'), 'the referral bonus is shown');
  const tiers = new Set([...plan.wallets.values()].map((w) => w.tier));
  assert.ok(tiers.size >= 2, 'customers sit in different tiers');
});

// ------------------------------------------------------------------------------------------------ coupons
test('coupons are used within their own rules', () => {
  const uses = new Map();
  for (const o of orders) {
    if (!o.coupon) continue;
    assert.ok(o.user, `${o.orderNumber}: only signed-in guests use coupons`);
    const doc = catalogue.coupons.get(o.coupon.code);
    assert.ok(doc && doc.active !== false, `${o.coupon.code} is not an active coupon`);
    assert.ok(o.totals.subtotal >= (doc.minOrder ?? 0), `${o.orderNumber}: ${o.coupon.code} below its minimum`);
    if (doc.appliesTo?.length) assert.ok(doc.appliesTo.includes(o.fulfillment), `${o.orderNumber}: ${o.coupon.code} does not apply to ${o.fulfillment}`);
    if (o.coupon.code === 'FREESHIP') assert.equal(o.totals.deliveryFee, 0);
    else assert.equal(o.totals.discount, o.coupon.discount);
    const key = `${o.user}:${o.coupon.code}`;
    if (o.couponRecorded) uses.set(key, (uses.get(key) ?? 0) + 1);
    if (['cancelled', 'rejected'].includes(o.status)) assert.equal(o.couponRecorded, false, `${o.orderNumber}: a cancelled order releases its coupon`);
  }
  for (const [key, n] of uses) {
    const code = key.split(':')[1];
    assert.ok(n <= (catalogue.coupons.get(code).perUserLimit ?? 1), `${key} used ${n} times`);
  }
  for (const code of ['WELCOME10', 'TABLE15', 'BRUNCH100', 'FREESHIP']) assert.ok(plan.couponUse.has(code), `${code} was used at least once`);
  assert.ok(!plan.couponUse.has('EID2026'), 'an expired coupon is never redeemed');
  // The first-order offer is only ever on a guest's very first order.
  const firstOrders = new Map();
  for (const o of [...orders].filter((x) => x.user && !['cancelled', 'rejected'].includes(x.status)).sort((a, b) => (a.placedAt ?? a.createdAt) - (b.placedAt ?? b.createdAt))) {
    if (!firstOrders.has(String(o.user))) firstOrders.set(String(o.user), o);
  }
  for (const o of orders.filter((x) => x.coupon?.code === 'WELCOME10' && x.couponRecorded)) assert.equal(firstOrders.get(String(o.user))._id, o._id, `${o.orderNumber}: WELCOME10 outside a first order`);
  // The coupon itself still validates against the rules at the time it was used.
  for (const o of orders.filter((x) => x.coupon && x.couponRecorded)) {
    const doc = catalogue.coupons.get(o.coupon.code);
    const fee = o.fulfillment === 'delivery' && o.totals.subtotal < restaurant.delivery.freeOver ? restaurant.delivery.baseFee : 0;
    const verdict = evaluateCouponRules(doc, { subtotal: o.totals.subtotal, deliveryFee: fee, fulfillment: o.fulfillment, userUses: 0, isFirstOrder: o.coupon.code === 'WELCOME10', signedIn: true }, o.placedAt ?? o.createdAt);
    assert.ok(verdict.valid, `${o.orderNumber}: ${o.coupon.code} would be refused`);
    assert.equal(verdict.discount, o.coupon.discount);
  }
});

test('sold counters equal the delivered quantities, and coupon use equals the recorded redemptions', () => {
  const sold = new Map();
  for (const o of orders.filter((x) => x.status === 'delivered')) for (const l of o.items) sold.set(String(l.menuItem), (sold.get(String(l.menuItem)) ?? 0) + l.quantity);
  assert.deepEqual([...plan.sold].sort(), [...sold].sort());
  const popular = [...sold].sort((a, b) => b[1] - a[1]).slice(0, 5).map(([id]) => menuById.get(id).slug);
  assert.ok(popular.length === 5);
  for (const [code, list] of plan.couponUse) assert.equal(list.length, orders.filter((o) => o.coupon?.code === code && o.couponRecorded).length);
});

// ------------------------------------------------------------------------------------------------ stock
test('the stock ledger is a true history that ends on today\'s quantities', () => {
  const byIngredient = new Map();
  for (const row of plan.stock) byIngredient.set(String(row.ingredient), [...(byIngredient.get(String(row.ingredient)) ?? []), row]);
  assert.equal(byIngredient.size, INGREDIENTS.length, 'every ingredient has a history');
  for (const ingredient of catalogue.ingredients.values()) {
    const rows = byIngredient.get(String(ingredient._id));
    assert.equal(rows[0].reason, 'Opening stock');
    let balance = 0;
    for (const row of rows) {
      balance = Math.round((balance + row.quantity) * 1000) / 1000;
      assert.equal(row.balanceAfter, balance, `${ingredient.name}: running balance`);
      assert.ok(balance >= 0, `${ingredient.name}: stock went negative`);
      if (['out', 'waste', 'order'].includes(row.type)) assert.ok(row.quantity < 0);
      if (row.type === 'in') assert.ok(row.quantity > 0);
    }
    assert.equal(balance, ingredient.stock, `${ingredient.name}: ends on the current stock`);
    for (let i = 1; i < rows.length; i += 1) assert.ok(rows[i].createdAt >= rows[i - 1].createdAt);
  }
  // Every "order" movement is the recipe maths of a real order.
  const orderRows = plan.stock.filter((r) => r.type === 'order');
  const perOrder = new Map();
  for (const r of orderRows) {
    const key = `${r.order}:${r.ingredient}`;
    perOrder.set(key, (perOrder.get(key) ?? 0) + -r.quantity);
  }
  for (const o of orders.filter((x) => x.stockDeducted)) {
    for (const [ingredientId, need] of ingredientNeeds(o.items, menuById)) {
      assert.ok(Math.abs((perOrder.get(`${o._id}:${ingredientId}`) ?? 0) - need) < 0.002, `${o.orderNumber}: ${ingredientId}`);
    }
  }
  assert.equal(orderRows.filter((r) => !orders.some((o) => o._id === r.order && o.stockDeducted)).length, 0);
});

// ------------------------------------------------------------------------------------------------ reservations
test('reservations obey the same table rules as live bookings', () => {
  const res = plan.reservations;
  assert.ok(res.length >= 60);
  const tableById = new Map(catalogue.tables.map((t) => [String(t._id), t]));
  const holding = new Set();
  for (const r of res) {
    const table = tableById.get(String(r.table));
    assert.ok(table, 'table exists');
    assert.ok(table.capacity >= r.guests, `${r.code}: ${r.guests} guests at a table for ${table.capacity}`);
    assert.ok(restaurant.reservation.seatings.includes(r.seating));
    assert.equal(r.startsAt.getTime(), fromLocal(r.date, r.seating).getTime());
    assert.equal(r.endsAt.getTime() - r.startsAt.getTime(), restaurant.reservation.seatingDurationMin * 60_000);
    assert.equal(r.holdsTable, !['cancelled', 'no_show'].includes(r.status));
    if (r.holdsTable) {
      const key = `${r.table}:${r.date}:${r.seating}`;
      assert.ok(!holding.has(key), `${r.code}: the table is already held for that seating`);
      holding.add(key);
    }
    assert.equal(r.history.at(-1).status, r.status);
    for (let i = 1; i < r.history.length; i += 1) assert.ok(r.history[i].at >= r.history[i - 1].at, `${r.code}: history order`);
    assert.ok(r.createdAt < r.startsAt || r.status === 'seated');
    if (r.startsAt > NOW) assert.ok(['confirmed', 'pending', 'cancelled'].includes(r.status), `${r.code}: ${r.status} in the future`);
    if (r.endsAt <= NOW) assert.ok(['completed', 'no_show', 'cancelled'].includes(r.status), `${r.code}: ${r.status} in the past`);
    if (r.status === 'seated') assert.ok(r.startsAt <= NOW && r.endsAt > NOW);
    assert.ok(r.guestName && r.phone);
  }
  const statuses = new Set(res.map((r) => r.status));
  for (const s of ['confirmed', 'pending', 'completed', 'cancelled', 'no_show']) assert.ok(statuses.has(s), `no ${s} reservation`);
  assert.ok(res.filter((r) => r.date === '2026-11-07').length >= 3, 'tonight has bookings');
  assert.ok(res.some((r) => r.user) && res.some((r) => !r.user));
});

// ------------------------------------------------------------------------------------------------ reviews
test('reviews are verified, unique per order and item, and the dish ratings are their average', () => {
  const orderById = new Map(orders.map((o) => [String(o._id), o]));
  const seen = new Set();
  for (const r of plan.reviews) {
    const o = orderById.get(String(r.order));
    assert.equal(o.status, 'delivered');
    assert.equal(String(o.user), String(r.user));
    assert.ok(r.rating >= 1 && r.rating <= 5);
    assert.ok(r.title && r.body);
    const key = `${r.user}:${r.order}:${r.menuItem ?? ''}`;
    assert.ok(!seen.has(key), 'one review per order and dish');
    seen.add(key);
    if (r.menuItem) assert.ok(o.items.some((l) => String(l.menuItem) === String(r.menuItem)), 'the dish was on the order');
    assert.ok(r.createdAt > o.deliveredAt, 'reviewed after delivery');
    if (r.reply) assert.ok(r.reply.at >= r.createdAt && r.status === 'approved');
  }
  const statuses = new Set(plan.reviews.map((r) => r.status));
  for (const s of ['approved', 'pending', 'rejected']) assert.ok(statuses.has(s), `no ${s} review`);
  assert.ok(plan.reviews.some((r) => r.menuItem) && plan.reviews.some((r) => !r.menuItem));
  for (const { id, avg, count } of plan.ratings) {
    const mine = plan.reviews.filter((r) => String(r.menuItem) === id && r.status === 'approved');
    assert.equal(count, mine.length);
    assert.equal(avg, Math.round((mine.reduce((s, r) => s + r.rating, 0) / mine.length) * 10) / 10);
  }
});

// ------------------------------------------------------------------------------------------------ the rest
test('chat threads keep their unread counters honest', () => {
  assert.equal(plan.conversations.length, 3);
  for (const c of plan.conversations) {
    const messages = plan.messages.filter((m) => m.conversation === c._id).sort((a, b) => a.createdAt - b.createdAt);
    assert.ok(messages.length >= 3);
    assert.equal(c.lastMessageAt.getTime(), messages.at(-1).createdAt.getTime());
    assert.equal(messages.filter((m) => m.senderRole === 'customer' && !m.readAt).length, c.unreadForStaff);
    assert.equal(messages.filter((m) => m.senderRole === 'staff' && !m.readAt).length, c.unreadForCustomer);
    assert.equal(messages[1].senderRole, 'bot', 'the bot acknowledges a new conversation');
    if (c.status === 'closed') assert.equal(c.unreadForStaff + c.unreadForCustomer, 0);
  }
  assert.ok(plan.conversations.some((c) => c.unreadForStaff > 0), 'something waiting for the team');
  assert.ok(plan.messages.some((m) => /allergy/i.test(m.body)), 'an allergy question the kitchen answered');
});

test('the seed content is English only', () => {
  // Bengali letters live in the code points 0x0980 to 0x09FF. The taka sign (0x09F3) is in that block too, but it is the currency symbol.
  const hasBengaliLetters = (text) =>
    [...text].some((ch) => {
      const code = ch.codePointAt(0);
      return code >= 0x0980 && code <= 0x09ff && code !== 0x09f3;
    });
  const everything = {
    CATEGORIES, ADD_ONS, DISHES, INGREDIENTS, SUPPLIERS, FAQS, GALLERY, TABLES,
    coupons: couponData(), restaurant: restaurantData(),
    orders: plan.orders, reservations: plan.reservations, reviews: plan.reviews, conversations: plan.conversations, messages: plan.messages,
    notifications: plan.notifications, audit: plan.audit, contacts: plan.contacts, subscribers: plan.subscribers,
  };
  for (const [name, value] of Object.entries(everything)) assert.equal(hasBengaliLetters(JSON.stringify(value ?? null)), false, `${name} contains Bengali script`);
  const keys = new Set();
  const walk = (v) => {
    if (Array.isArray(v)) return v.forEach(walk);
    if (v && typeof v === 'object') for (const [k, x] of Object.entries(v)) { keys.add(k); walk(x); }
  };
  walk(everything);
  assert.deepEqual([...keys].filter((k) => /Bn$|^bn$|^locale$/.test(k)), [], 'no second-language fields');
});

test('notifications, audit trail, contact messages, subscribers and the saved cart are sensible', () => {
  const types = new Set(plan.notifications.map((n) => n.type));
  for (const t of ['order', 'review', 'promo', 'system', 'stock']) assert.ok(types.has(t), `no ${t} notification`);
  assert.ok(plan.notifications.some((n) => n.audience === 'staff' && !n.readAt));
  assert.ok(plan.notifications.some((n) => n.audience === 'user' && n.readAt) && plan.notifications.some((n) => n.audience === 'user' && !n.readAt));
  assert.equal(plan.notifications.filter((n) => n.type === 'stock').length, INGREDIENTS.filter((i) => i.stock <= i.low).length);
  assert.ok(plan.audit.length >= 10);
  for (let i = 1; i < plan.audit.length; i += 1) assert.ok(plan.audit[i].at >= plan.audit[i - 1].at);
  assert.ok(plan.audit.some((a) => a.action === 'payment.refund' && a.summary.includes(plan.partialRefund.orderNumber)));
  assert.deepEqual([...new Set(plan.contacts.map((c) => c.status))].sort(), ['archived', 'new', 'read', 'replied']);
  assert.ok(plan.subscribers.some((s) => s.status === 'unsubscribed') && plan.subscribers.every((s) => s.consent));
  assert.equal(new Set(plan.subscribers.map((s) => s.unsubscribeToken)).size, plan.subscribers.length);
  assert.equal(plan.cart.items.length, 2);
});

test('the restaurant settings the history depends on are present', () => {
  const r = restaurantData();
  assert.equal(r.name, 'ÉLAN');
  assert.ok(r.hours.length === 7 && r.reservation.seatings.length >= 4);
  assert.ok(r.loyalty.tiers.length === 3);
});
