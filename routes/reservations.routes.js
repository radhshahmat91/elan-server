import { Router } from 'express';
import { Reservation, Table } from '../models/index.js';
import { RESERVATION_STATUSES, SEATING_PREFERENCES } from '../models/constants.js';
import { requireAuth, requirePermission } from '../middleware/auth.js';
import { limiter } from '../middleware/rateLimit.js';
import { dateKey, email, objectId, phone, timeHm, validate, z } from '../middleware/validate.js';
import { conflict, notFound } from '../utils/errors.js';
import { created, containsRegex, ok, pageMeta, parsePagination } from '../utils/http.js';
import { audit } from '../services/auditService.js';
import { getRestaurant } from '../services/restaurantService.js';
import {
  cancelOwnReservation,
  createReservation,
  findByPublicId,
  getAvailability,
  getDayPlan,
  rescheduleReservation,
  serializeReservation,
  setReservationStatus,
} from '../services/reservationService.js';

export const basePath = '/reservations';
const router = Router();

const opt = (schema) => z.union([schema, z.literal('').transform(() => undefined)]).optional();
const actorOf = (req) => ({ id: req.user._id, name: req.user.name, role: req.user.role });
const guestActor = (req) => (req.user ? { id: req.user._id, name: req.user.name, role: 'customer' } : { name: 'Guest', role: 'guest' });

const bookBody = z.object({
  date: dateKey,
  time: timeHm,
  guests: z.number().int().min(1).max(40),
  name: z.string().trim().min(2, 'Enter your name').max(80).optional(),
  phone: opt(phone),
  email: opt(email),
  seatingPreference: z.enum(SEATING_PREFERENCES).default('any'),
  occasion: z.string().trim().max(60).optional(),
  specialRequests: z.string().trim().max(500).optional(),
});

// Public ---------------------------------------------------------------------------------------------

router.get(
  '/availability',
  limiter({ windowMs: 60_000, limit: 60 }),
  validate({ query: z.object({ date: dateKey, guests: z.coerce.number().int().min(1).max(40), seating: z.enum(SEATING_PREFERENCES).default('any') }) }),
  async (req, res) => {
    const { date, guests, seating } = req.valid.query;
    ok(res, await getAvailability({ date, guests, seatingPreference: seating }));
  },
);

router.post('/', limiter({ windowMs: 10 * 60_000, limit: 12, message: 'Too many booking attempts. Please wait a few minutes or call us.' }), validate({ body: bookBody }), async (req, res) => {
  const { reservation, restaurant } = await createReservation({ input: req.valid.body, user: req.user });
  created(res, serializeReservation(reservation, 'owner', restaurant));
});

router.get('/mine', requireAuth, async (req, res) => {
  const restaurant = await getRestaurant();
  const rows = await Reservation.find({ user: req.user._id }).sort({ startsAt: -1 }).limit(60).populate('table', 'number section capacity').lean();
  ok(res, rows.map((r) => serializeReservation(r, 'owner', restaurant)));
});

// The manage link is the capability: whoever holds the unguessable id may view, change or cancel that booking.
router.get('/manage/:publicId', async (req, res) => {
  const [r, restaurant] = await Promise.all([findByPublicId(req.params.publicId), getRestaurant()]);
  ok(res, serializeReservation(r, 'owner', restaurant));
});

router.put(
  '/manage/:publicId',
  limiter({ windowMs: 10 * 60_000, limit: 20 }),
  validate({ body: bookBody.pick({ date: true, time: true, guests: true, seatingPreference: true, occasion: true, specialRequests: true }).partial() }),
  async (req, res) => {
    const r = await findByPublicId(req.params.publicId);
    const updated = await rescheduleReservation({ reservation: r, input: req.valid.body, actor: guestActor(req) });
    ok(res, serializeReservation(updated, 'owner', await getRestaurant()));
  },
);

router.post('/manage/:publicId/cancel', limiter({ windowMs: 10 * 60_000, limit: 20 }), async (req, res) => {
  const r = await findByPublicId(req.params.publicId);
  const updated = await cancelOwnReservation({ reservation: r, actor: guestActor(req) });
  ok(res, serializeReservation(updated, 'owner', await getRestaurant()));
});

// Staff ----------------------------------------------------------------------------------------------

const listQuery = z.object({
  date: dateKey.optional(),
  from: dateKey.optional(),
  to: dateKey.optional(),
  status: z.enum(RESERVATION_STATUSES).optional(),
  q: z.string().trim().max(80).optional(),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(30),
});

router.get('/admin', requirePermission('reservations:read'), validate({ query: listQuery }), async (req, res) => {
  const q = req.valid.query;
  const filter = {};
  if (q.date) filter.date = q.date;
  else if (q.from || q.to) filter.date = { ...(q.from ? { $gte: q.from } : {}), ...(q.to ? { $lte: q.to } : {}) };
  if (q.status) filter.status = q.status;
  if (q.q) {
    const re = containsRegex(q.q);
    filter.$or = [{ guestName: re }, { phone: re }, { code: re }, { email: re }];
  }
  const { skip, limit, page, pageSize } = parsePagination(req.valid.query, { defaultSize: 30, maxSize: 100 });
  const [rows, total, restaurant] = await Promise.all([
    Reservation.find(filter).sort({ startsAt: q.date ? 1 : -1 }).skip(skip).limit(limit).populate('table', 'number section capacity').lean(),
    Reservation.countDocuments(filter),
    getRestaurant(),
  ]);
  ok(res, rows.map((r) => serializeReservation(r, 'staff', restaurant)), pageMeta({ page, pageSize }, total));
});

router.get('/admin/day/:date', requirePermission('reservations:read'), validate({ params: z.object({ date: dateKey }) }), async (req, res) => {
  ok(res, await getDayPlan(req.valid.params.date));
});

router.post('/admin', requirePermission('reservations:create'), validate({ body: bookBody }), async (req, res) => {
  const { reservation, restaurant } = await createReservation({ input: req.valid.body, staff: true, actor: actorOf(req) });
  await audit(req, 'reservation.create', { type: 'reservation', id: reservation._id }, `Booked ${reservation.code} for ${reservation.guestName}`);
  created(res, serializeReservation(reservation, 'staff', restaurant));
});

router.patch(
  '/admin/:id/status',
  requirePermission('reservations:update'),
  validate({ params: z.object({ id: objectId }), body: z.object({ status: z.enum(RESERVATION_STATUSES), note: z.string().trim().max(300).optional() }) }),
  async (req, res) => {
    const r = await Reservation.findById(req.valid.params.id);
    if (!r) throw notFound('Reservation not found.');
    const updated = await setReservationStatus({ reservation: r, status: req.valid.body.status, actor: actorOf(req), note: req.valid.body.note });
    await audit(req, 'reservation.status', { type: 'reservation', id: r._id }, `${r.code}: ${r.status} to ${req.valid.body.status}`);
    ok(res, serializeReservation(updated, 'staff', await getRestaurant()));
  },
);

router.put(
  '/admin/:id',
  requirePermission('reservations:update'),
  validate({ params: z.object({ id: objectId }), body: bookBody.pick({ date: true, time: true, guests: true, seatingPreference: true, occasion: true, specialRequests: true }).partial() }),
  async (req, res) => {
    const r = await Reservation.findById(req.valid.params.id);
    if (!r) throw notFound('Reservation not found.');
    const updated = await rescheduleReservation({ reservation: r, input: req.valid.body, actor: actorOf(req), staff: true });
    await audit(req, 'reservation.update', { type: 'reservation', id: r._id }, `Changed ${r.code}`, { fields: Object.keys(req.valid.body) });
    ok(res, serializeReservation(updated, 'staff', await getRestaurant()));
  },
);

// Move a booking to a specific table (e.g. a regular's favourite), keeping date and seating.
router.post(
  '/admin/:id/table',
  requirePermission('reservations:update'),
  validate({ params: z.object({ id: objectId }), body: z.object({ tableId: objectId }) }),
  async (req, res) => {
    const [r, table] = await Promise.all([Reservation.findById(req.valid.params.id), Table.findOne({ _id: req.valid.body.tableId, active: true })]);
    if (!r || !table) throw notFound('Reservation or table not found.');
    if (table.capacity < r.guests) throw conflict(`Table ${table.number} seats ${table.capacity}, but this party is ${r.guests}.`, 'TABLE_TOO_SMALL');
    try {
      await Reservation.updateOne({ _id: r._id, status: { $in: ['pending', 'confirmed', 'seated'] } }, { $set: { table: table._id }, $push: { history: { status: r.status, at: new Date(), by: actorOf(req), note: `Moved to table ${table.number}` } } });
    } catch (err) {
      if (err?.code === 11000) throw conflict(`Table ${table.number} is already booked for that seating.`, 'TABLE_TAKEN');
      throw err;
    }
    await audit(req, 'reservation.table', { type: 'reservation', id: r._id }, `${r.code} moved to table ${table.number}`);
    ok(res, serializeReservation(await Reservation.findById(r._id).populate('table'), 'staff', await getRestaurant()));
  },
);

export default router;
