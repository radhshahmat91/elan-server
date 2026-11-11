import test from 'node:test';
import assert from 'node:assert/strict';
import { pointsForTotal, tierFor } from '../services/loyaltyService.js';
import { computeOpenState } from '../services/restaurantService.js';
import { ingredientNeeds } from '../services/inventoryService.js';
import { serializeOrder } from '../serializers/order.js';
import { serializeMenuItem } from '../serializers/menu.js';
import { can, permissionsFor, isStaff } from '../utils/permissions.js';
import { hashPassword, verifyPassword, signToken, verifyToken, sha256, safeEqual } from '../utils/crypto.js';
import { addDays, dateKey, fromLocal, isValidDateKey, isValidTime, localParts, weekdayOf } from '../utils/dates.js';
import { slugify } from '../utils/ids.js';
import { csvCell } from '../utils/format.js';
import { DEFAULT_TIERS } from '../models/constants.js';

test('loyalty tiers follow lifetime points', () => {
  assert.equal(tierFor(0, DEFAULT_TIERS).key, 'initie');
  assert.equal(tierFor(999, DEFAULT_TIERS).key, 'initie');
  assert.equal(tierFor(1000, DEFAULT_TIERS).key, 'habitue');
  assert.equal(tierFor(5000, DEFAULT_TIERS).key, 'elite');
});

test('points earned are floor(total x rate x tier multiplier)', () => {
  assert.equal(pointsForTotal(2500, 0.1, { multiplier: 1 }), 250);
  assert.equal(pointsForTotal(2500, 0.1, { multiplier: 1.25 }), 312);
  assert.equal(pointsForTotal(2500, 0.1, { multiplier: 1.5 }), 375);
  assert.equal(pointsForTotal(5, 0.1, { multiplier: 1 }), 0);
});

test('role permissions: customers get nothing, owners everything, chefs only the kitchen', () => {
  assert.equal(can('owner', 'anything:at-all'), true);
  assert.equal(can('manager', 'menu:update'), true);
  assert.equal(can('manager', 'settings:update'), false);
  assert.equal(can('chef', 'orders:progress'), true);
  assert.equal(can('chef', 'menu:update'), false);
  assert.equal(can('delivery', 'deliveries:update'), true);
  assert.equal(can('delivery', 'orders:update'), false);
  assert.equal(can('customer', 'orders:read'), false);
  assert.deepEqual(permissionsFor('nobody'), []);
  assert.equal(isStaff('customer'), false);
  assert.equal(isStaff('chef'), true);
});

test('Dhaka local time helpers use a fixed +06:00 offset', () => {
  const instant = new Date('2026-11-05T18:30:00Z'); // 00:30 on the 6th in Dhaka
  assert.equal(dateKey(instant), '2026-11-06');
  assert.equal(localParts(instant).hour, 0);
  assert.equal(fromLocal('2026-11-06', '00:30').toISOString(), '2026-11-05T18:30:00.000Z');
  assert.equal(weekdayOf('2026-11-06'), 5);
  assert.equal(addDays('2026-12-31', 1), '2027-01-01');
  assert.equal(isValidDateKey('2026-02-30'), false);
  assert.equal(isValidDateKey('2026-11-05'), true);
  assert.equal(isValidTime('24:00'), false);
  assert.equal(isValidTime('19:30'), true);
});

const hours = (open, close, closed = false) => Array.from({ length: 7 }, (_, day) => ({ day, open, close, closed }));

test('open state: inside, outside, overnight and closed dates', () => {
  const r = { hours: hours('12:00', '23:00'), closedDates: [] };
  assert.equal(computeOpenState(r, new Date('2026-11-05T08:00:00Z')).openNow, true); // 14:00 Dhaka
  assert.equal(computeOpenState(r, new Date('2026-11-05T03:00:00Z')).openNow, false); // 09:00 Dhaka
  assert.equal(computeOpenState(r, new Date('2026-11-05T17:30:00Z')).openNow, false); // 23:30 Dhaka
  const late = { hours: hours('18:00', '01:00'), closedDates: [] };
  assert.equal(computeOpenState(late, new Date('2026-11-05T18:30:00Z')).openNow, true); // 00:30 Dhaka, still open
  assert.equal(computeOpenState(late, new Date('2026-11-05T22:00:00Z')).openNow, false); // 04:00 Dhaka
  const shut = { hours: hours('12:00', '23:00'), closedDates: [{ date: '2026-11-05' }] };
  const state = computeOpenState(shut, new Date('2026-11-05T08:00:00Z'));
  assert.equal(state.openNow, false);
  assert.equal(state.todayHours.closed, true);
});

test('ingredient needs multiply recipe quantity by ordered quantity', () => {
  const menu = new Map([['m1', { recipe: [{ ingredient: 'a', quantity: 150 }, { ingredient: 'b', quantity: 2 }] }], ['m2', { recipe: [{ ingredient: 'a', quantity: 50 }] }]]);
  const needs = ingredientNeeds([{ menuItem: 'm1', quantity: 3 }, { menuItem: 'm2', quantity: 2 }, { menuItem: 'gone', quantity: 1 }], menu);
  assert.equal(needs.get('a'), 550);
  assert.equal(needs.get('b'), 6);
});

const rawOrder = {
  _id: 'o1', publicId: 'abc123def456gh', orderNumber: 'EL-261105-1111', status: 'placed', fulfillment: 'delivery', source: 'web', user: 'u9',
  customer: { name: 'Rahim Uddin', phone: '+8801711000000', email: 'rahim@example.com' },
  address: { line1: 'House 7, Road 3', area: 'Banani', city: 'Dhaka' }, notes: 'Ring twice',
  items: [{ name: 'Burrata', quantity: 1, unitPrice: 900, lineTotal: 900, options: [] }],
  totals: { subtotal: 900, total: 1065 }, payment: { method: 'cod', status: 'cash_due', provider: 'cod' },
  statusHistory: [{ status: 'placed', at: new Date(), by: { name: 'Rahim', role: 'customer' }, note: 'internal note' }],
};

test('the public order view never exposes contact details, street address or internal notes', () => {
  const dto = JSON.stringify(serializeOrder(rawOrder, 'public'));
  for (const secret of ['+8801711000000', 'rahim@example.com', 'House 7', 'Ring twice', 'internal note', 'Rahim Uddin']) assert.equal(dto.includes(secret), false, secret);
  assert.match(dto, /"customerFirstName":"Rahim"/);
  assert.match(dto, /Banani/);
});

test('owner and staff views include contact details; staff also see history notes', () => {
  assert.equal(serializeOrder(rawOrder, 'owner').customer.phone, '+8801711000000');
  assert.equal(serializeOrder(rawOrder, 'owner').timeline[0].note, undefined);
  assert.equal(serializeOrder(rawOrder, 'staff').timeline[0].note, 'internal note');
});

test('menu DTO: quickAdd is false when a required option group exists; admin-only fields stay hidden', () => {
  const doc = { _id: 'm1', slug: 's', name: 'N', description: 'd', price: 100, available: true, archived: false, tags: [], allergens: [], images: [], category: { _id: 'c1', name: 'Mains', slug: 'mains' }, optionGroups: [{ _id: 'g1', key: 'k', name: 'G', isRequired: true, minSelect: 1, maxSelect: 1, active: true, choices: [] }], recipe: [{ ingredient: 'x', quantity: 1 }], sku: 'SKU-1' };
  const dto = serializeMenuItem(doc, { detail: true });
  assert.equal(dto.quickAdd, false);
  assert.equal(dto.category.slug, 'mains');
  assert.equal(dto.optionGroups.length, 1);
  assert.equal('recipe' in dto, false);
  assert.equal('sku' in dto, false);
  assert.equal(serializeMenuItem({ ...doc, optionGroups: [] }).quickAdd, true);
  assert.equal(serializeMenuItem({ ...doc, archived: true }).available, false);
});

test('passwords hash with scrypt, verify, and reject near misses', async () => {
  const hash = await hashPassword('Elan@Demo2026');
  assert.match(hash, /^scrypt\$/);
  assert.equal(await verifyPassword('Elan@Demo2026', hash), true);
  assert.equal(await verifyPassword('elan@demo2026', hash), false);
  assert.equal(await verifyPassword('Elan@Demo2026', 'garbage'), false);
  assert.notEqual(await hashPassword('Elan@Demo2026'), hash); // random salt
});

test('signed tokens verify, expire and detect tampering', () => {
  const secret = 'unit-test-secret-unit-test-secret';
  const token = signToken({ sub: 'u1', typ: 'socket' }, secret, 60);
  assert.equal(verifyToken(token, secret).sub, 'u1');
  assert.equal(verifyToken(token, 'other-secret-other-secret-xx'), null);
  assert.equal(verifyToken(`${token}x`, secret), null);
  assert.equal(verifyToken(signToken({ sub: 'u1' }, secret, -5), secret), null);
  assert.equal(verifyToken('not.a.token', secret), null);
  assert.equal(sha256('a').length, 64);
  assert.equal(safeEqual('abc', 'abc'), true);
  assert.equal(safeEqual('abc', 'abd'), false);
});

test('slugs are ascii, hyphenated and diacritic-free', () => {
  assert.equal(slugify('Crème Brûlée & Coffee'), 'creme-brulee-and-coffee');
  assert.equal(slugify('  Hilsa — Mustard  '), 'hilsa-mustard');
});

test('csv cells are quoted and neutralise spreadsheet formulas', () => {
  assert.equal(csvCell('plain'), 'plain');
  assert.equal(csvCell('a,b'), '"a,b"');
  assert.equal(csvCell('say "hi"'), '"say ""hi"""');
  assert.equal(csvCell('=SUM(A1:A9)'), "'=SUM(A1:A9)");
  assert.equal(csvCell(null), '');
});
