import test from 'node:test';
import assert from 'node:assert/strict';
import {
  FAQ_STRONG,
  FAQ_WEAK,
  bestFaq,
  describeFilters,
  detectIntent,
  detectMenuFilters,
  normalize,
  parseBudget,
  scoreFaq,
  summariseHours,
  tokenize,
} from '../services/conciergeService.js';
import { CSV_COLUMNS, assembleOverview, fillDailySeries, orderCsvRow, pctChange, resolveRange, tzString } from '../services/analyticsService.js';
import { daysUntil, expiryState, serializeIngredient, signedQuantity, stockStatus } from '../serializers/inventory.js';
import { buildProfile, mergeUnique, pairingCategories, scoreForYou } from '../services/recommendationService.js';
import { buildInvoiceModel, latin, money, samePhone } from '../services/invoiceService.js';
import { sniffImage } from '../services/uploadService.js';
import { restaurantData } from '../seed/data/restaurant.js';

// ---------------------------------------------------------------------------------------------- concierge

test('budgets are read from English and Bengali phrasing', () => {
  assert.equal(parseBudget('vegetarian dishes under 800'), 800);
  assert.equal(parseBudget('anything below ৳1,200 please'), 1200);
  assert.equal(parseBudget('less than 500 taka'), 500);
  assert.equal(parseBudget('৮০০ টাকার নিচে নিরামিষ'), 800);
  assert.equal(parseBudget('1500 or less'), 1500);
  assert.equal(parseBudget('what is popular'), null);
  assert.equal(parseBudget('under 5'), null); // too small to be a price
});

test('menu questions are recognised: tags, categories, popularity', () => {
  const veg = detectMenuFilters('Any vegetarian starters under 600?');
  assert.deepEqual(veg.tags, ['vegetarian']);
  assert.equal(veg.category, 'starters');
  assert.equal(veg.maxPrice, 600);
  assert.equal(detectMenuFilters('do you have vegan desserts').tags[0], 'vegan');
  assert.equal(detectMenuFilters('gluten free please').tags[0], 'gluten-free');
  assert.equal(detectMenuFilters('what is most popular').popular, true);
  assert.equal(detectMenuFilters('can you recommend something').recommend, true);
  assert.equal(detectMenuFilters('নিরামিষ খাবার').tags[0], 'vegetarian');
  assert.equal(detectMenuFilters('কফি আছে?').category, 'drinks');
  assert.equal(detectMenuFilters('hello').any, false);
});

test('intents: live questions go to live data, menu questions stay with the menu', () => {
  assert.equal(detectIntent('hello').intent, 'greeting');
  assert.equal(detectIntent('Assalamu alaikum').intent, 'greeting');
  assert.equal(detectIntent('হ্যালো').intent, 'greeting');
  assert.equal(detectIntent('thank you!').intent, 'thanks');
  assert.equal(detectIntent('What are your opening hours?').intent, 'hours');
  assert.equal(detectIntent('এখন কি খোলা আছে').intent, 'hours');
  assert.equal(detectIntent('How much is delivery?').intent, 'delivery');
  assert.equal(detectIntent('Can I book a table for 4?').intent, 'reservation');
  assert.equal(detectIntent('how do points work').intent, 'loyalty');
  assert.equal(detectIntent('can I pay with bkash').intent, 'payment');
  assert.equal(detectIntent('where is my order').intent, 'track');
  assert.equal(detectIntent('what is your address').intent, 'contact');
  // mentions delivery, but is really a menu question
  assert.equal(detectIntent('which vegetarian dishes do you deliver').intent, 'menu');
  assert.equal(detectIntent('vegan options under 900').intent, 'menu');
  assert.equal(detectIntent('asdf qwer').intent, 'none');
  assert.equal(detectIntent('   ').intent, 'none');
});

test('FAQ matching scores keyword hits above shared words, and ignores noise', () => {
  const faq = { question: 'Do you take large group bookings?', questionBn: '', keywords: ['group', 'party', 'large booking'], keywordsBn: ['দল'] };
  const other = { question: 'Is there parking nearby?', keywords: ['parking', 'valet'], keywordsBn: [] };
  assert.ok(scoreFaq('can I bring a large group of 12', faq) >= FAQ_STRONG);
  assert.ok(scoreFaq('is there valet parking', other) >= FAQ_STRONG);
  assert.equal(scoreFaq('is there valet parking', faq), 0);
  assert.equal(scoreFaq('', faq), 0);
  assert.equal(bestFaq('valet parking please', [faq, other]).faq, other);
  assert.equal(bestFaq('nothing relevant here at all', [faq, other]), null);
  assert.ok(FAQ_STRONG > FAQ_WEAK);
});

test('text normalisation handles Bengali digits, case and punctuation', () => {
  assert.equal(normalize('  Hello,   WORLD!! '), 'hello, world');
  assert.equal(normalize('৳১,২০০'), '৳1,200');
  assert.deepEqual(tokenize('The best vegan dishes for you'), ['best', 'vegan', 'dishes']);
});

test('opening hours collapse into readable ranges', () => {
  const { hours } = restaurantData();
  assert.equal(summariseHours(hours, 'en'), 'Mon to Thu 12:00-23:00, Fri to Sat 12:00-23:30, Sun 12:00-22:30');
  assert.match(summariseHours(hours, 'bn'), /সোম থেকে বৃহ 12:00-23:00/);
  const withClosedDay = hours.map((h) => (h.day === 1 ? { ...h, closed: true } : h));
  assert.match(summariseHours(withClosedDay, 'en'), /Mon closed, Tue to Thu 12:00-23:00/);
});

test('filter descriptions read naturally', () => {
  assert.equal(describeFilters({ tags: ['vegetarian'], category: 'starters', maxPrice: 600, popular: false, recommend: false }, 'en'), 'vegetarian starters under ৳600');
  assert.equal(describeFilters({ tags: [], category: null, maxPrice: null, popular: true, recommend: false }, 'en'), 'most-ordered dishes');
  assert.equal(describeFilters({ tags: ['gluten-free'], category: null, maxPrice: null, popular: false, recommend: false }, 'en'), 'gluten free dishes');
});

// ---------------------------------------------------------------------------------------------- analytics

const NOW = new Date('2026-11-06T04:00:00Z'); // Friday 10:00 in Dhaka

test('date ranges: presets end today, custom ranges are clamped, the previous period matches in length', () => {
  const r = resolveRange({ range: '7d' }, NOW);
  assert.deepEqual([r.from, r.to, r.days], ['2026-10-31', '2026-11-06', 7]);
  assert.deepEqual(r.previous, { from: '2026-10-24', to: '2026-10-30' });
  assert.equal(resolveRange({}, NOW).days, 30);
  assert.equal(resolveRange({ range: '90d' }, NOW).days, 90);
  const custom = resolveRange({ from: '2026-11-10', to: '2026-11-01' }, NOW); // reversed and in the future
  assert.deepEqual([custom.from, custom.to], ['2026-11-01', '2026-11-06']);
  assert.equal(resolveRange({ from: '2020-01-01', to: '2026-11-06' }, NOW).days, 366);
});

test('time zone offsets are formatted for MongoDB', () => {
  assert.equal(tzString(360), '+06:00');
  assert.equal(tzString(-300), '-05:00');
  assert.equal(tzString(330), '+05:30');
  assert.equal(tzString(0), '+00:00');
});

test('percentage change: rounded, and honest when there is nothing to compare with', () => {
  assert.equal(pctChange(150, 100), 50);
  assert.equal(pctChange(80, 100), -20);
  assert.equal(pctChange(101, 300), -66.3);
  assert.equal(pctChange(0, 0), 0);
  assert.equal(pctChange(10, 0), null);
});

test('daily series has one row per day, zero-filled', () => {
  const range = resolveRange({ range: '7d' }, NOW);
  const series = fillDailySeries(range, [{ _id: '2026-11-04', revenue: 5000, orders: 4 }]);
  assert.equal(series.length, 7);
  assert.deepEqual(series[0], { date: '2026-10-31', revenue: 0, orders: 0 });
  assert.deepEqual(series[4], { date: '2026-11-04', revenue: 5000, orders: 4 });
});

test('the overview is assembled from raw aggregation rows', () => {
  const range = resolveRange({ range: '7d' }, NOW);
  const overview = assembleOverview({
    range,
    daily: [{ _id: '2026-11-05', revenue: 6000, orders: 4 }, { _id: '2026-11-06', revenue: 4000, orders: 1 }],
    placed: {
      total: [{ n: 10 }],
      byStatus: [{ _id: 'delivered', n: 5 }, { _id: 'cancelled', n: 1 }, { _id: 'rejected', n: 1 }, { _id: 'preparing', n: 3 }],
      hours: [{ _id: 19, n: 6 }, { _id: 20, n: 4 }],
      weekdays: [{ _id: 7, n: 7 }, { _id: 1, n: 3 }], // Mongo $dayOfWeek: 1 = Sunday ... 7 = Saturday
    },
    delivered: {
      fulfillment: [{ _id: 'delivery', orders: 3, revenue: 7000 }, { _id: 'dine_in', orders: 2, revenue: 3000 }],
      payment: [{ _id: 'cod', orders: 2, revenue: 2000 }, { _id: 'card', orders: 3, revenue: 8000 }],
      weekdays: [{ _id: 7, orders: 4, revenue: 9000 }],
    },
    items: { items: [{ _id: 'a1', name: 'Hilsa', category: 'Mains', quantity: 6, revenue: 7200 }], categories: [{ _id: 'Mains', quantity: 8, revenue: 9000 }] },
    previous: { revenue: 5000, orders: 4 },
    newCustomers: 6,
    previousNewCustomers: 3,
    reservations: [{ _id: 'completed', n: 4, guests: 14 }, { _id: 'seated', n: 1, guests: 2 }, { _id: 'no_show', n: 1, guests: 3 }, { _id: 'cancelled', n: 2, guests: 6 }],
    topCustomers: [{ id: 'u1', name: 'Anika', orders: 3, spent: 4200 }],
    repeat: { customers: 5, repeat: 2 },
  });
  assert.equal(overview.kpis.revenue, 10000);
  assert.equal(overview.kpis.delivered, 5);
  assert.equal(overview.kpis.averageOrder, 2000);
  assert.equal(overview.kpis.orders, 10);
  assert.equal(overview.kpis.cancelRate, 20);
  assert.equal(overview.kpis.repeatRate, 40);
  assert.equal(overview.kpis.reservations, 8);
  assert.equal(overview.kpis.covers, 16);
  assert.equal(overview.kpis.noShowRate, 12.5);
  assert.equal(overview.change.revenue, 100);
  assert.equal(overview.change.newCustomers, 100);
  assert.equal(overview.series.length, 7);
  assert.equal(overview.hours.length, 24);
  assert.equal(overview.hours[19].orders, 6);
  assert.equal(overview.weekdays.find((d) => d.name === 'Friday').orders, 0);
  assert.equal(overview.weekdays.find((d) => d.name === 'Friday').revenue, 0);
  assert.equal(overview.weekdays.find((d) => d.name === 'Saturday').orders, 7);
  assert.equal(overview.weekdays.find((d) => d.name === 'Saturday').revenue, 9000);
  assert.equal(overview.weekdays.find((d) => d.name === 'Sunday').orders, 3);
  assert.equal(overview.byFulfillment[0].key, 'delivery');
  assert.equal(overview.byPayment[0].key, 'card');
  assert.equal(overview.topItems[0].name, 'Hilsa');
});

test('an empty period produces zeros, never NaN', () => {
  const overview = assembleOverview({ range: resolveRange({ range: '7d' }, NOW), daily: [], placed: {}, delivered: {}, items: {}, previous: undefined, newCustomers: 0, previousNewCustomers: 0, reservations: [], topCustomers: [], repeat: undefined });
  for (const value of Object.values(overview.kpis)) assert.equal(Number.isFinite(value), true);
  assert.equal(overview.kpis.averageOrder, 0);
  assert.equal(overview.change.revenue, 0);
});

test('CSV rows are one line each with the documented columns, and cells cannot inject formulas', () => {
  const row = orderCsvRow({
    orderNumber: 'EL-261106-0001',
    deliveredAt: new Date('2026-11-06T10:00:00Z'),
    fulfillment: 'delivery',
    payment: { method: 'cod' },
    items: [{ quantity: 2 }, { quantity: 1 }],
    totals: { subtotal: 2000, discount: 100, loyaltyDiscount: 0, deliveryFee: 120, serviceCharge: 0, tax: 100, total: 2120 },
  });
  assert.equal(row.split(',').length, CSV_COLUMNS.length);
  assert.equal(row, 'EL-261106-0001,2026-11-06T10:00:00.000Z,delivery,cod,3,2000,100,0,120,0,100,2120');
  assert.ok(orderCsvRow({ orderNumber: '=HYPERLINK("x")', totals: {} }).startsWith(`"'=HYPERLINK`));
});

// ---------------------------------------------------------------------------------------------- stock

test('stock status: out at zero, low at the alert level, ok above it', () => {
  assert.equal(stockStatus({ stock: 0, lowStockThreshold: 5 }), 'out');
  assert.equal(stockStatus({ stock: -2, lowStockThreshold: 0 }), 'out');
  assert.equal(stockStatus({ stock: 5, lowStockThreshold: 5 }), 'low');
  assert.equal(stockStatus({ stock: 5.1, lowStockThreshold: 5 }), 'ok');
  assert.equal(stockStatus({ stock: 1, lowStockThreshold: 0 }), 'ok'); // no alert level set
});

test('expiry: days are counted up, past is expired, within three days is soon', () => {
  assert.equal(daysUntil(null, NOW), null);
  assert.equal(daysUntil(new Date('2026-11-09T04:00:00Z'), NOW), 3);
  assert.equal(daysUntil(new Date('2026-11-05T04:00:00Z'), NOW), -1);
  assert.equal(expiryState(null), 'none');
  assert.equal(expiryState(-1), 'expired');
  assert.equal(expiryState(3), 'soon');
  assert.equal(expiryState(4), 'ok');
});

test('stock movements are signed the way the admin form describes them', () => {
  assert.equal(signedQuantity('in', 5), 5);
  assert.equal(signedQuantity('in', -5), 5);
  assert.equal(signedQuantity('out', 2), -2);
  assert.equal(signedQuantity('waste', -3), -3);
  assert.equal(signedQuantity('adjust', -1.5), -1.5);
  assert.equal(signedQuantity('adjust', 0), 0);
  assert.equal(signedQuantity('in', 'abc'), 0);
});

test('an ingredient is serialised with value, status and expiry', () => {
  const dto = serializeIngredient({ _id: 'i1', name: 'Hilsa', unit: 'kg', stock: 2.5004, lowStockThreshold: 3, costPerUnit: 1800, supplier: { _id: 's1', name: 'River Co' }, nearestExpiry: new Date('2026-11-07T04:00:00Z'), active: true }, NOW);
  assert.equal(dto.stock, 2.5);
  assert.equal(dto.value, 4500);
  assert.equal(dto.status, 'low');
  assert.equal(dto.expiry, 'soon');
  assert.equal(dto.nearestExpiry, '2026-11-07');
  assert.deepEqual(dto.supplier, { id: 's1', name: 'River Co' });
  assert.equal(serializeIngredient({ _id: 'i2', name: 'Salt', unit: 'kg', stock: 0, supplier: null }, NOW).value, 0);
});

// ---------------------------------------------------------------------------------------------- recommendations

test('a guest profile counts categories and dishes, and the score rewards affinity and penalises repetition', () => {
  const profile = buildProfile([
    { items: [{ menuItem: 'a', categoryName: 'Mains', quantity: 2 }, { menuItem: 'b', categoryName: 'Desserts', quantity: 1 }] },
    { items: [{ menuItem: 'a', categoryName: 'Mains', quantity: 1 }] },
  ]);
  assert.equal(profile.categories.get('Mains'), 3);
  assert.equal(profile.items.get('a'), 3);
  const base = { soldCount: 10, featured: false, rating: { avg: 4 } };
  const mainsNew = scoreForYou({ ...base, _id: 'c', category: { name: 'Mains' } }, profile);
  const drinksNew = scoreForYou({ ...base, _id: 'd', category: { name: 'Drinks' } }, profile);
  const mainsRepeat = scoreForYou({ ...base, _id: 'a', category: { name: 'Mains' } }, profile);
  assert.ok(mainsNew > drinksNew, 'a category the guest orders from scores higher');
  assert.ok(mainsRepeat < mainsNew, 'a dish they just had scores lower');
  const empty = buildProfile([]);
  assert.ok(scoreForYou({ ...base, soldCount: 100, _id: 'x', category: { name: 'Mains' } }, empty) > scoreForYou({ ...base, soldCount: 1, _id: 'y', category: { name: 'Mains' } }, empty));
});

test('pairing lists merge in priority order without duplicates or the dish itself', () => {
  assert.deepEqual(mergeUnique([['a', 'b'], ['b', 'c', 'd'], ['e']], 4, ['a']), ['b', 'c', 'd', 'e']);
  assert.deepEqual(mergeUnique([['a', 'b', 'c']], 2), ['a', 'b']);
  assert.deepEqual(mergeUnique([], 3), []);
  assert.ok(pairingCategories('Mains').some((re) => re.test('Desserts')));
  assert.ok(pairingCategories('Desserts').some((re) => re.test('Drinks')));
  assert.ok(pairingCategories('Something else').length > 0);
});

// ---------------------------------------------------------------------------------------------- invoices

test('phone numbers match by their last ten digits', () => {
  assert.equal(samePhone('+880 1700-000000', '01700000000'), true);
  assert.equal(samePhone('01700000000', '01700000001'), false);
  assert.equal(samePhone('', ''), false);
  assert.equal(samePhone('123', '123'), false); // too short to be a phone number
  assert.equal(samePhone(undefined, '01700000000'), false);
});

test('the PDF only receives characters its fonts can draw', () => {
  assert.equal(latin('ÉLAN Café'), 'ÉLAN Café');
  assert.equal(latin('রহিম'), '????'); // four code points, none drawable
  assert.equal(latin('৳500'), '?500');
  assert.equal(money(1450), 'BDT 1,450');
  assert.equal(money(undefined), 'BDT 0');
});

test('the invoice model lists only the totals that apply and flags sandbox payments', () => {
  const restaurant = restaurantData();
  const order = {
    orderNumber: 'EL-261106-0042',
    createdAt: new Date('2026-11-06T12:00:00Z'),
    status: 'delivered',
    fulfillment: 'delivery',
    address: { recipient: 'Anika Rahman', line1: 'House 4, Road 11', area: 'Banani', city: 'Dhaka' },
    customer: { name: 'Anika Rahman', phone: '+8801700000000' },
    items: [{ name: 'Hilsa', quantity: 2, unitPrice: 1400, lineTotal: 2800, options: [{ choiceName: 'Extra mustard' }] }],
    totals: { subtotal: 2800, discount: 280, loyaltyDiscount: 0, deliveryFee: 120, serviceCharge: 0, tax: 140, total: 2780 },
    coupon: { code: 'WELCOME10' },
    payment: { method: 'card', status: 'paid', provider: 'sandbox', refundedTotal: 0 },
  };
  const model = buildInvoiceModel(order, restaurant);
  assert.equal(model.number, 'EL-261106-0042');
  assert.equal(model.sandbox, true);
  assert.equal(model.payment, 'Card, paid');
  assert.deepEqual(model.totals.map((t) => t.label), ['Subtotal', 'Coupon WELCOME10', 'Delivery', 'VAT', 'Total']);
  assert.equal(model.totals.find((t) => t.label.startsWith('Coupon')).amount, -280);
  assert.equal(model.totals.at(-1).strong, true);
  assert.equal(model.lines[0].options, 'Extra mustard');
  assert.deepEqual(model.customer.lines, ['Anika Rahman', 'House 4, Road 11', 'Banani, Dhaka']);

  const dineIn = buildInvoiceModel({ ...order, fulfillment: 'dine_in', tableNumber: '7', payment: { method: 'cod', status: 'paid', provider: 'cod' } }, restaurant);
  assert.deepEqual(dineIn.customer.lines, ['Dine-in, table 7']);
  assert.equal(dineIn.sandbox, false);
});

// ---------------------------------------------------------------------------------------------- uploads

test('images are recognised by their bytes, not their names', () => {
  const jpeg = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0, 0x10, 0x4a, 0x46, 0x49, 0x46, 0, 1]);
  const png = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0x0d]);
  const webp = Buffer.concat([Buffer.from('RIFF'), Buffer.from([0, 0, 0, 0]), Buffer.from('WEBPVP8 ')]);
  const avif = Buffer.concat([Buffer.from([0, 0, 0, 0x1c]), Buffer.from('ftypavif'), Buffer.from([0, 0, 0, 0])]);
  assert.deepEqual(sniffImage(jpeg), { mime: 'image/jpeg', ext: 'jpg' });
  assert.deepEqual(sniffImage(png), { mime: 'image/png', ext: 'png' });
  assert.deepEqual(sniffImage(webp), { mime: 'image/webp', ext: 'webp' });
  assert.deepEqual(sniffImage(avif), { mime: 'image/avif', ext: 'avif' });
  assert.equal(sniffImage(Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>')), null);
  assert.equal(sniffImage(Buffer.from('GIF89a......')), null);
  assert.equal(sniffImage(Buffer.from('MZ\x90\x00 an executable pretending to be a picture')), null);
  assert.equal(sniffImage(Buffer.alloc(4)), null);
  assert.equal(sniffImage(null), null);
});
