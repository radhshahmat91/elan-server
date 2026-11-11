import test from 'node:test';
import assert from 'node:assert/strict';
import {
  RESERVATION_FLOW,
  closedMessage,
  computeSlots,
  guestCanChange,
  humanDate,
  humanTime,
  seatingWithinHours,
  serializeReservation,
} from '../services/reservationService.js';
import { displayName, serializeReview } from '../services/reviewService.js';
import { restaurantData } from '../seed/data/restaurant.js';

// Friday 6 November 2026, 10:00 in Dhaka (UTC+6)
const NOW = new Date('2026-11-06T04:00:00Z');
const FRIDAY = '2026-11-06';

const tables = [
  { _id: 't1', number: '1', capacity: 2, section: 'indoor', active: true },
  { _id: 't2', number: '2', capacity: 4, section: 'window', active: true },
  { _id: 't3', number: '3', capacity: 8, section: 'private', active: true },
];

const restaurant = () => ({ ...restaurantData(), acceptingReservations: true, closedDates: [] });
const slots = (overrides = {}) => computeSlots({ date: FRIDAY, guests: 2, now: NOW, restaurant: restaurant(), tables, taken: new Set(), ...overrides });

test('every configured seating inside opening hours is offered', () => {
  const result = slots();
  assert.equal(result.closed, undefined);
  assert.deepEqual(result.slots.map((s) => s.time), ['12:00', '13:30', '15:00', '18:00', '19:30', '21:00']);
  assert.ok(result.slots.every((s) => s.available && s.tablesLeft === 3));
});

test('a held table removes one table from that seating only', () => {
  const taken = new Set([`t1:${FRIDAY}:19:30`]);
  const result = slots({ taken });
  assert.equal(result.slots.find((s) => s.time === '19:30').tablesLeft, 2);
  assert.equal(result.slots.find((s) => s.time === '18:00').tablesLeft, 3);
});

test('a fully held seating is full, and the reason says so', () => {
  const taken = new Set(tables.map((t) => `${t._id}:${FRIDAY}:21:00`));
  const full = slots({ taken }).slots.find((s) => s.time === '21:00');
  assert.equal(full.available, false);
  assert.equal(full.reason, 'full');
});

test('party size decides which tables count: five guests only fit the private room', () => {
  const result = slots({ guests: 5 });
  assert.ok(result.slots.every((s) => s.tablesLeft === 1));
  const taken = new Set([`t3:${FRIDAY}:18:00`]);
  assert.equal(slots({ guests: 5, taken }).slots.find((s) => s.time === '18:00').available, false);
});

test('seating preference narrows the tables', () => {
  assert.equal(slots({ seatingPreference: 'window' }).slots[0].tablesLeft, 1);
  assert.equal(slots({ seatingPreference: 'outdoor' }).closed, 'no_table_fits');
});

test('inactive tables are never offered', () => {
  const inactive = tables.map((t) => ({ ...t, active: false }));
  assert.equal(slots({ tables: inactive }).closed, 'no_table_fits');
});

test('seatings that start inside the minimum lead time are marked too_soon', () => {
  const now = new Date('2026-11-06T06:30:00Z'); // 12:30 in Dhaka, lead time 60 minutes => 13:30 is the first bookable seating
  const result = slots({ now });
  const byTime = Object.fromEntries(result.slots.map((s) => [s.time, s]));
  assert.equal(byTime['12:00'].available, false);
  assert.equal(byTime['12:00'].reason, 'too_soon');
  assert.equal(byTime['13:30'].available, true);
});

test('staff can book inside the lead time and while online booking is paused', () => {
  const now = new Date('2026-11-06T07:00:00Z'); // 13:00 in Dhaka: the 13:30 seating is 30 minutes away, inside the 60 minute guest lead time
  const at1330 = (result) => result.slots.find((s) => s.time === '13:30');
  assert.equal(at1330(slots({ now })).available, false);
  assert.equal(at1330(slots({ now })).reason, 'too_soon');
  assert.equal(at1330(slots({ now, staff: true })).available, true);
  assert.equal(slots({ now, staff: true }).slots.find((s) => s.time === '12:00').available, false); // already started: nobody can book the past
  const paused = { ...restaurant(), acceptingReservations: false };
  assert.equal(slots({ restaurant: paused }).closed, 'paused');
  assert.notEqual(slots({ restaurant: paused, staff: true }).closed, 'paused');
});

test('closed reasons: past, too far ahead, invalid date, party size, closed weekday, closed date', () => {
  assert.equal(slots({ date: '2026-11-05' }).closed, 'past');
  assert.equal(slots({ date: '2027-01-05' }).closed, undefined); // exactly advanceDays (60) ahead is allowed
  assert.equal(slots({ date: '2027-01-06' }).closed, 'too_far');
  assert.equal(slots({ date: '2026-02-30' }).closed, 'invalid_date');
  assert.equal(slots({ date: 'tomorrow' }).closed, 'invalid_date');
  assert.equal(slots({ guests: 13 }).closed, 'party_size');
  assert.equal(slots({ guests: 0 }).closed, 'party_size');

  const noFridays = restaurant();
  noFridays.hours = noFridays.hours.map((h) => (h.day === 5 ? { ...h, closed: true } : h));
  assert.equal(slots({ restaurant: noFridays }).closed, 'closed_day');

  const holiday = { ...restaurant(), closedDates: [{ date: '2026-11-07', reason: 'Private event' }] };
  assert.equal(slots({ restaurant: holiday, date: '2026-11-07' }).closed, 'closed_day');
});

test('every closed reason has a human message', () => {
  for (const reason of ['paused', 'invalid_date', 'past', 'too_far', 'party_size', 'closed_day', 'no_table_fits']) {
    const message = closedMessage(reason);
    assert.ok(message.length > 12 && message.endsWith('.'), `${reason} needs a full sentence`);
  }
  assert.match(closedMessage('something_new'), /not available/);
});

test('seatings are matched against opening hours, including hours that run past midnight', () => {
  const day = { open: '12:00', close: '23:00' };
  assert.equal(seatingWithinHours(day, '12:00'), true);
  assert.equal(seatingWithinHours(day, '22:59'), true);
  assert.equal(seatingWithinHours(day, '23:00'), false);
  assert.equal(seatingWithinHours(day, '11:30'), false);
  const late = { open: '18:00', close: '02:00' };
  assert.equal(seatingWithinHours(late, '23:30'), true);
  assert.equal(seatingWithinHours(late, '01:00'), true);
  assert.equal(seatingWithinHours(late, '12:00'), false);
});

test('guests may change a booking until cancelBeforeHours before it starts, and only while it is open', () => {
  const at = (hours) => new Date(NOW.getTime() + hours * 3_600_000);
  assert.equal(guestCanChange({ status: 'confirmed', startsAt: at(5) }, 4, NOW), true);
  assert.equal(guestCanChange({ status: 'confirmed', startsAt: at(4) }, 4, NOW), true);
  assert.equal(guestCanChange({ status: 'confirmed', startsAt: at(3) }, 4, NOW), false);
  assert.equal(guestCanChange({ status: 'pending', startsAt: at(48) }, 4, NOW), true);
  for (const status of ['cancelled', 'completed', 'no_show', 'seated']) assert.equal(guestCanChange({ status, startsAt: at(48) }, 4, NOW), false);
});

test('the reservation lifecycle has no way back from a closed booking', () => {
  assert.deepEqual(RESERVATION_FLOW.pending, ['confirmed', 'cancelled']);
  assert.ok(RESERVATION_FLOW.confirmed.includes('seated'));
  assert.ok(RESERVATION_FLOW.confirmed.includes('no_show'));
  assert.deepEqual(RESERVATION_FLOW.seated, ['completed']);
  for (const closed of ['completed', 'cancelled', 'no_show']) assert.deepEqual(RESERVATION_FLOW[closed], []);
});

test('dates and times read the way a guest says them', () => {
  assert.equal(humanDate('2026-11-06'), 'Friday, 6 November 2026');
  assert.equal(humanTime('00:00'), '12:00 AM');
  assert.equal(humanTime('12:00'), '12:00 PM');
  assert.equal(humanTime('19:30'), '7:30 PM');
  assert.equal(humanTime('09:05'), '9:05 AM');
});

test('the guest view of a reservation hides staff-only fields; the staff view adds them', () => {
  const doc = {
    _id: 'r1',
    code: 'RV-ABC123',
    publicId: 'abcdefghijklmn',
    status: 'confirmed',
    date: '2026-11-20',
    seating: '19:30',
    startsAt: new Date('2026-11-20T13:30:00Z'),
    endsAt: new Date('2026-11-20T15:00:00Z'),
    guests: 4,
    guestName: 'Anika Rahman',
    phone: '+8801700000000',
    seatingPreference: 'window',
    table: { _id: 't2', number: '2', capacity: 4, section: 'window' },
    user: 'u1',
    isDemo: true,
    history: [{ status: 'confirmed', at: new Date(), by: { name: 'Guest' }, note: 'internal' }],
  };
  const guest = serializeReservation(doc, 'owner', restaurant());
  assert.equal(guest.time, '19:30');
  assert.equal(guest.section, 'window');
  assert.equal('history' in guest, false);
  assert.equal('userId' in guest, false);
  assert.equal('table' in guest, false);
  const staff = serializeReservation(doc, 'staff', restaurant());
  assert.equal(staff.table.number, '2');
  assert.equal(staff.userId, 'u1');
  assert.equal(staff.history.length, 1);
  // A pending request has no confirmed table yet, so the guest is not told one.
  assert.equal(serializeReservation({ ...doc, status: 'pending' }, 'owner', restaurant()).section, undefined);
});

test('reviews show a short name and never the author id or order unless moderating', () => {
  assert.equal(displayName('Rahim Uddin'), 'Rahim U.');
  assert.equal(displayName('Tahmina'), 'Tahmina');
  assert.equal(displayName('  anika   rahman '), 'anika R.');
  assert.equal(displayName(''), 'Guest');
  const doc = { _id: 'v1', rating: 5, body: 'Lovely hilsa, perfectly cooked.', authorName: 'Rahim Uddin', status: 'approved', order: 'o1', user: 'u1', createdAt: new Date() };
  const pub = serializeReview(doc);
  assert.equal(pub.authorName, 'Rahim U.');
  assert.equal('userId' in pub, false);
  assert.equal('status' in pub, false);
  const admin = serializeReview(doc, { admin: true });
  assert.equal(admin.status, 'approved');
  assert.equal(admin.orderId, 'o1');
});
