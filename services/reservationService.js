// Reservations: availability by seating, race-free booking (partial unique index), changes, cancellation and staff status moves.
//
// Double booking is impossible by construction: a booking inserts a row with holdsTable = true, and the partial unique
// index on (table, date, seating) rejects a second holder of the same table and seating, however many requests race.
// The booking loop simply tries the next best-fitting table when it loses a race.
import { Reservation, Table } from '../models/index.js';
import { env } from '../config/env.js';
import { EVENTS, emitToRoom, rooms } from '../sockets/events.js';
import { conflict, notFound, unprocessable } from '../utils/errors.js';
import { addDays, dateKey, fromLocal, isValidDateKey, weekdayOf } from '../utils/dates.js';
import { publicId as makePublicId, reservationCode } from '../utils/ids.js';
import { emailLayout, escapeHtml } from '../utils/emailLayout.js';
import { logger } from '../utils/logger.js';
import { getRestaurant } from './restaurantService.js';
import { notifyStaff, notifyUser, sendEmail } from './notificationService.js';

const WEEKDAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const OPEN = ['pending', 'confirmed'];

const toMinutes = (hm) => {
  const [h, m] = String(hm).split(':').map(Number);
  return h * 60 + m;
};

export function humanDate(key) {
  const [y, m, d] = key.split('-').map(Number);
  return `${WEEKDAYS[weekdayOf(key)]}, ${d} ${MONTHS[m - 1]} ${y}`;
}

export function humanTime(hm) {
  const [h, m] = hm.split(':').map(Number);
  const suffix = h >= 12 ? 'PM' : 'AM';
  return `${h % 12 === 0 ? 12 : h % 12}:${String(m).padStart(2, '0')} ${suffix}`;
}

/** Pure. A seating is bookable when its start time is inside that day's opening hours (hours may run past midnight). */
export function seatingWithinHours(row, seating) {
  const start = toMinutes(seating);
  const open = toMinutes(row.open);
  const close = toMinutes(row.close);
  if (close > open) return start >= open && start < close;
  return start >= open || start < close; // overnight
}

const CLOSED_MESSAGES = {
  paused: 'Online reservations are paused right now. Please call us to book a table.',
  invalid_date: 'Choose a valid date.',
  past: 'That date has already passed.',
  too_far: 'That date is further ahead than we take bookings for.',
  party_size: 'That party is larger than we can book online. Please call us and we will arrange it.',
  closed_day: 'We are closed on that day. Please choose another date.',
  no_table_fits: 'We do not have a table that fits that party in that area. Try another area or call us.',
};
export const closedMessage = (reason) => CLOSED_MESSAGES[reason] ?? 'Reservations are not available for that date.';

/**
 * Pure. Which seatings can be booked on `date` for `guests`, given the tables and which (table, date, seating) are already held?
 * `taken` is a Set of `${tableId}:${date}:${seating}`. Returns { closed? } or { slots: [{ time, startsAt, available, tablesLeft, reason? }] }.
 */
export function computeSlots({ date, guests, seatingPreference = 'any', now = new Date(), restaurant, tables, taken, staff = false }) {
  const cfg = restaurant.reservation;
  if (!restaurant.acceptingReservations && !staff) return { closed: 'paused', slots: [] };
  if (!isValidDateKey(date)) return { closed: 'invalid_date', slots: [] };
  const today = dateKey(now);
  if (date < today) return { closed: 'past', slots: [] };
  if (date > addDays(today, cfg.advanceDays)) return { closed: 'too_far', slots: [] };
  if (!(guests >= 1) || guests > cfg.maxGuests) return { closed: 'party_size', slots: [] };
  const row = (restaurant.hours ?? []).find((h) => h.day === weekdayOf(date));
  if (!row || row.closed || (restaurant.closedDates ?? []).some((d) => d.date === date)) return { closed: 'closed_day', slots: [] };

  const fits = tables.filter((t) => t.active !== false && t.capacity >= guests && (seatingPreference === 'any' || t.section === seatingPreference));
  if (fits.length === 0) return { closed: 'no_table_fits', slots: [] };

  const earliest = new Date(now.getTime() + (staff ? 0 : cfg.minLeadMinutes) * 60_000);
  const slots = cfg.seatings
    .filter((time) => seatingWithinHours(row, time))
    .map((time) => {
      const startsAt = fromLocal(date, time);
      const free = fits.filter((t) => !taken.has(`${t._id}:${date}:${time}`));
      const future = startsAt >= earliest;
      return { time, startsAt, available: future && free.length > 0, tablesLeft: future ? free.length : 0, reason: !future ? 'too_soon' : free.length === 0 ? 'full' : undefined };
    });
  return { slots };
}

async function loadAvailability({ date, guests, seatingPreference, staff = false, ignoreReservationId }) {
  const restaurant = await getRestaurant();
  const [tables, booked] = await Promise.all([
    Table.find({ active: true }).sort({ capacity: 1, number: 1 }).lean(),
    Reservation.find({ date, holdsTable: true }).select('table seating').lean(),
  ]);
  const taken = new Set(booked.filter((r) => String(r._id) !== String(ignoreReservationId ?? '')).map((r) => `${r.table}:${date}:${r.seating}`));
  const result = computeSlots({ date, guests, seatingPreference, restaurant, tables, taken, staff });
  return { ...result, restaurant, tables, taken };
}

/** Public availability for the booking form. */
export async function getAvailability({ date, guests, seatingPreference = 'any' }) {
  const { closed, slots } = await loadAvailability({ date, guests, seatingPreference });
  return {
    date,
    guests,
    closed: closed ? { reason: closed, message: closedMessage(closed) } : undefined,
    slots: slots.map((s) => ({ time: s.time, available: s.available, scarce: s.available && s.tablesLeft <= 2, reason: s.reason })),
  };
}

const noAvailability = (availability, time) => {
  const alternatives = (availability.slots ?? []).filter((s) => s.available && s.time !== time).map((s) => s.time);
  return conflict(
    alternatives.length ? 'That time has just been taken. These seatings are still free that day.' : 'We are fully booked for that day. Please try another date.',
    'NO_AVAILABILITY',
    { alternatives },
  );
};

const statusLine = (status) => (status === 'confirmed' ? 'Your table is confirmed.' : 'We have your request and will confirm it shortly.');

export function manageUrl(r) {
  return `${env.PUBLIC_CLIENT_URL}/reservation/${r.publicId}`;
}

function reservationEmail(r, headline) {
  const when = `${humanDate(r.date)} at ${humanTime(r.seating)}`;
  return {
    subject: `${headline}: ${when} (${r.code})`,
    html: emailLayout({
      title: headline,
      preheader: `${when}, ${r.guests} guest${r.guests === 1 ? '' : 's'}`,
      bodyHtml: `<p style="margin:0 0 12px">${escapeHtml(statusLine(r.status))}</p>
        <p style="margin:0;font-size:18px">${escapeHtml(when)}</p>
        <p style="margin:4px 0 12px;color:#bba99a">${r.guests} guest${r.guests === 1 ? '' : 's'}, booking ${escapeHtml(r.code)}</p>
        <p style="margin:0;color:#bba99a;font-size:13px">You can change or cancel your booking at any time from the link below.</p>`,
      cta: { label: 'Manage booking', url: manageUrl(r) },
    }),
    text: `${headline}\n${when}, ${r.guests} guest(s)\nBooking ${r.code}\nManage: ${manageUrl(r)}`,
  };
}

/** Pure. May the guest still cancel or change it themselves? */
export function guestCanChange(r, cancelBeforeHours, now = new Date()) {
  return OPEN.includes(r.status) && new Date(r.startsAt).getTime() - now.getTime() >= cancelBeforeHours * 3_600_000;
}

export function serializeReservation(r, audience = 'owner', restaurant) {
  const o = typeof r.toObject === 'function' ? r.toObject() : r;
  const table = o.table && typeof o.table === 'object' && o.table.number ? o.table : null;
  const cancelHours = restaurant?.reservation?.cancelBeforeHours ?? 4;
  const dto = {
    id: String(o._id),
    code: o.code,
    publicId: o.publicId,
    status: o.status,
    date: o.date,
    time: o.seating,
    startsAt: o.startsAt,
    endsAt: o.endsAt,
    guests: o.guests,
    guestName: o.guestName,
    seatingPreference: o.seatingPreference,
    occasion: o.occasion || undefined,
    specialRequests: o.specialRequests || undefined,
    phone: o.phone,
    email: o.email || undefined,
    section: table && ['confirmed', 'seated', 'completed'].includes(o.status) ? table.section : undefined,
    canChange: guestCanChange(o, cancelHours),
    cancelBefore: new Date(new Date(o.startsAt).getTime() - cancelHours * 3_600_000).toISOString(),
    createdAt: o.createdAt,
  };
  if (audience === 'staff') {
    dto.table = table ? { id: String(table._id), number: table.number, capacity: table.capacity, section: table.section } : undefined;
    dto.userId = o.user ? String(o.user) : undefined;
    dto.isDemo = Boolean(o.isDemo);
    dto.history = (o.history ?? []).map((h) => ({ status: h.status, at: h.at, by: h.by?.name, note: h.note || undefined }));
  }
  return dto;
}

async function announce(r, { restaurant, created: isNew }) {
  try {
    const populated = r.populated?.('table') ? r : await r.populate('table');
    emitToRoom(rooms.admin, isNew ? EVENTS.RESERVATION_NEW : EVENTS.RESERVATION_UPDATE, serializeReservation(populated, 'staff', restaurant));
    if (r.user) emitToRoom(rooms.user(String(r.user)), EVENTS.RESERVATION_UPDATE, serializeReservation(populated, 'owner', restaurant));
  } catch (err) {
    logger.warn('reservation broadcast failed', { code: r.code, message: err.message });
  }
}

async function notifyGuest(r, headline) {
  try {
    const mail = reservationEmail(r, headline);
    if (r.user) {
      await notifyUser(r.user, { type: 'reservation', title: headline, body: `${humanDate(r.date)} at ${humanTime(r.seating)} for ${r.guests}`, link: `/reservation/${r.publicId}`, prefKey: 'reservationUpdates', email: mail });
    } else if (r.email) {
      await sendEmail({ to: r.email, ...mail });
    }
  } catch (err) {
    logger.warn('reservation notification failed', { code: r.code, message: err.message });
  }
}

/** Books a table. `staff` bookings (phone calls, walk-ins) skip the lead-time rule and are confirmed at once. */
export async function createReservation({ input, user = null, staff = false, actor }) {
  const guestName = input.name || user?.name;
  const phone = input.phone || user?.phone;
  if (!guestName || !phone) {
    throw unprocessable('Add a name and phone number so we can reach you about your table.', [
      ...(!guestName ? [{ path: 'name', message: 'Enter your name' }] : []),
      ...(!phone ? [{ path: 'phone', message: 'Enter a phone number' }] : []),
    ]);
  }
  const email = (input.email || user?.email || '').toLowerCase() || undefined;
  const availability = await loadAvailability({ date: input.date, guests: input.guests, seatingPreference: input.seatingPreference, staff });
  if (availability.closed) throw unprocessable(closedMessage(availability.closed));
  const { restaurant } = availability;
  const slot = availability.slots.find((s) => s.time === input.time);
  if (!slot) throw unprocessable('That time is not one of our seatings. Please choose from the list.');
  if (!slot.available) {
    if (slot.reason === 'too_soon') throw unprocessable(`Online bookings need at least ${restaurant.reservation.minLeadMinutes} minutes notice. Please choose a later seating or call us.`);
    throw noAvailability(availability, input.time);
  }

  if (!staff) {
    const open = await Reservation.countDocuments({ phone, status: { $in: OPEN }, startsAt: { $gt: new Date() } });
    if (open >= 3) throw conflict('You already have three upcoming reservations. Please cancel one or call us to add another.', 'RESERVATION_LIMIT');
  }

  const startsAt = slot.startsAt;
  const endsAt = new Date(startsAt.getTime() + restaurant.reservation.seatingDurationMin * 60_000);
  const status = staff || restaurant.reservation.autoConfirm ? 'confirmed' : 'pending';
  const candidates = availability.tables.filter(
    (t) => t.active !== false && t.capacity >= input.guests && (input.seatingPreference === 'any' || t.section === input.seatingPreference) && !availability.taken.has(`${t._id}:${input.date}:${input.time}`),
  ); // already ordered smallest first: the best fit keeps big tables free for big parties

  let doc = null;
  for (const table of candidates) {
    for (let attempt = 0; attempt < 3 && !doc; attempt += 1) {
      try {
        doc = await Reservation.create({
          code: reservationCode(),
          publicId: makePublicId(),
          user: user?._id ?? null,
          guestName,
          phone,
          email,
          date: input.date,
          seating: input.time,
          startsAt,
          endsAt,
          guests: input.guests,
          table: table._id,
          seatingPreference: input.seatingPreference ?? 'any',
          occasion: input.occasion || undefined,
          specialRequests: input.specialRequests || undefined,
          status,
          history: [{ status, at: new Date(), by: actor ?? (user ? { id: user._id, name: user.name, role: 'customer' } : { name: 'Guest', role: 'guest' }), note: staff ? 'Booked by staff' : undefined }],
        });
      } catch (err) {
        if (err?.code !== 11000) throw err;
        if (!(err.keyPattern?.code || err.keyPattern?.publicId)) break; // someone took this table first: try the next one
      }
    }
    if (doc) break;
  }
  if (!doc) throw noAvailability(await loadAvailability({ date: input.date, guests: input.guests, seatingPreference: input.seatingPreference, staff }), input.time);

  await doc.populate('table');
  await announce(doc, { restaurant, created: true });
  await notifyStaff({ type: 'reservation', title: `New reservation ${doc.code}`, body: `${humanDate(doc.date)} ${humanTime(doc.seating)}, ${doc.guests} guests, ${doc.guestName}`, link: '/admin/reservations' }, { roles: ['manager', 'owner'] });
  await notifyGuest(doc, status === 'confirmed' ? 'Your table is booked' : 'Reservation request received');
  return { reservation: doc, restaurant };
}

const STAFF_FLOW = {
  pending: ['confirmed', 'cancelled'],
  confirmed: ['seated', 'cancelled', 'no_show'],
  seated: ['completed'],
  completed: [],
  cancelled: [],
  no_show: [],
};
export const RESERVATION_FLOW = STAFF_FLOW;

/** Moves a reservation along its lifecycle. Cancelled and no-show bookings release their table at once. */
export async function setReservationStatus({ reservation, status, actor, note }) {
  const from = reservation.status;
  if (!STAFF_FLOW[from]?.includes(status)) throw conflict(`A ${from.replace('_', ' ')} booking cannot become ${status.replace('_', ' ')}.`, 'INVALID_TRANSITION');
  const set = { status };
  if (status === 'cancelled' || status === 'no_show') set.holdsTable = false;
  const updated = await Reservation.findOneAndUpdate(
    { _id: reservation._id, status: from },
    { $set: set, $push: { history: { status, at: new Date(), by: actor, note } } },
    { new: true },
  ).populate('table');
  if (!updated) throw conflict('Someone else just changed this booking. Refresh and try again.', 'STALE_STATUS');
  const restaurant = await getRestaurant();
  await announce(updated, { restaurant, created: false });
  if (status === 'confirmed') await notifyGuest(updated, 'Your table is confirmed');
  if (status === 'cancelled') await notifyGuest(updated, 'Your reservation was cancelled');
  return updated;
}

/** A guest cancelling their own booking: allowed until `cancelBeforeHours` before the seating. */
export async function cancelOwnReservation({ reservation, actor }) {
  const restaurant = await getRestaurant();
  if (!OPEN.includes(reservation.status)) throw conflict('This booking is already closed.', 'NOT_OPEN');
  if (!guestCanChange(reservation, restaurant.reservation.cancelBeforeHours)) {
    throw conflict(`Bookings can be cancelled online up to ${restaurant.reservation.cancelBeforeHours} hours before. Please call us and we will help.`, 'TOO_LATE');
  }
  return setReservationStatus({ reservation, status: 'cancelled', actor, note: 'Cancelled by guest' });
}

/** Moves a booking to another date, seating or party size. The old table is released only when the new one is secured. */
export async function rescheduleReservation({ reservation, input, actor, staff = false }) {
  if (!OPEN.includes(reservation.status)) throw conflict('Only upcoming bookings can be changed.', 'NOT_OPEN');
  const restaurant = await getRestaurant();
  if (!staff && !guestCanChange(reservation, restaurant.reservation.cancelBeforeHours)) {
    throw conflict(`Bookings can be changed online up to ${restaurant.reservation.cancelBeforeHours} hours before. Please call us and we will help.`, 'TOO_LATE');
  }
  const next = {
    date: input.date ?? reservation.date,
    time: input.time ?? reservation.seating,
    guests: input.guests ?? reservation.guests,
    seatingPreference: input.seatingPreference ?? reservation.seatingPreference,
  };
  const availability = await loadAvailability({ date: next.date, guests: next.guests, seatingPreference: next.seatingPreference, staff, ignoreReservationId: reservation._id });
  if (availability.closed) throw unprocessable(closedMessage(availability.closed));
  const slot = availability.slots.find((s) => s.time === next.time);
  if (!slot) throw unprocessable('That time is not one of our seatings.');
  if (!slot.available) throw noAvailability(availability, next.time);
  const startsAt = slot.startsAt;
  const endsAt = new Date(startsAt.getTime() + restaurant.reservation.seatingDurationMin * 60_000);
  const candidates = availability.tables.filter(
    (t) => t.active !== false && t.capacity >= next.guests && (next.seatingPreference === 'any' || t.section === next.seatingPreference) && !availability.taken.has(`${t._id}:${next.date}:${next.time}`),
  );
  // Keep the current table when it still fits, so regulars keep "their" table.
  candidates.sort((a, b) => (String(b._id) === String(reservation.table) ? 1 : 0) - (String(a._id) === String(reservation.table) ? 1 : 0));

  let updated = null;
  for (const table of candidates) {
    try {
      updated = await Reservation.findOneAndUpdate(
        { _id: reservation._id, status: { $in: OPEN } },
        {
          $set: { date: next.date, seating: next.time, startsAt, endsAt, guests: next.guests, seatingPreference: next.seatingPreference, table: table._id, ...(input.occasion !== undefined ? { occasion: input.occasion || undefined } : {}), ...(input.specialRequests !== undefined ? { specialRequests: input.specialRequests || undefined } : {}) },
          $push: { history: { status: reservation.status, at: new Date(), by: actor, note: 'Details changed' } },
        },
        { new: true },
      ).populate('table');
      if (updated) break;
    } catch (err) {
      if (err?.code !== 11000) throw err; // lost the race for this table: try the next one
    }
  }
  if (!updated) throw noAvailability(await loadAvailability({ date: next.date, guests: next.guests, seatingPreference: next.seatingPreference, staff, ignoreReservationId: reservation._id }), next.time);
  await announce(updated, { restaurant, created: false });
  await notifyGuest(updated, 'Your reservation was updated');
  return updated;
}

/** Floor view for one day: every table with who holds it at each seating. */
export async function getDayPlan(date) {
  const restaurant = await getRestaurant();
  const [tables, bookings] = await Promise.all([
    Table.find({ active: true }).sort({ section: 1, number: 1 }).lean(),
    Reservation.find({ date, status: { $in: ['pending', 'confirmed', 'seated', 'completed'] } }).populate('table', 'number').lean(),
  ]);
  const byTable = new Map();
  for (const b of bookings) byTable.set(`${b.table?._id ?? b.table}:${b.seating}`, b);
  const row = restaurant.hours.find((h) => h.day === weekdayOf(date));
  const seatings = restaurant.reservation.seatings.filter((s) => row && !row.closed && seatingWithinHours(row, s));
  return {
    date,
    seatings,
    tables: tables.map((t) => ({
      id: String(t._id),
      number: t.number,
      name: t.name || undefined,
      capacity: t.capacity,
      section: t.section,
      slots: Object.fromEntries(
        seatings.map((s) => {
          const b = byTable.get(`${t._id}:${s}`);
          return [s, b ? { reservationId: String(b._id), code: b.code, guestName: b.guestName, guests: b.guests, status: b.status } : null];
        }),
      ),
    })),
    totals: {
      reservations: bookings.filter((b) => ['pending', 'confirmed', 'seated'].includes(b.status)).length,
      guests: bookings.filter((b) => ['pending', 'confirmed', 'seated'].includes(b.status)).reduce((sum, b) => sum + b.guests, 0),
    },
  };
}

/** Admin: tables are looked up by Mongo id or reservation code elsewhere; this finds by the manage-link id. */
export async function findByPublicId(publicId) {
  const r = await Reservation.findOne({ publicId: String(publicId) }).populate('table');
  if (!r) throw notFound('We could not find that reservation. Check the link and try again.');
  return r;
}
