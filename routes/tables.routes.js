import { Router } from 'express';
import { Reservation, Table } from '../models/index.js';
import { TABLE_SECTIONS } from '../models/constants.js';
import { requirePermission } from '../middleware/auth.js';
import { limiter } from '../middleware/rateLimit.js';
import { objectId, validate, z } from '../middleware/validate.js';
import { env } from '../config/env.js';
import { randomToken, safeEqual } from '../utils/crypto.js';
import { conflict, notFound } from '../utils/errors.js';
import { created, ok } from '../utils/http.js';
import { dateKey } from '../utils/dates.js';
import { audit } from '../services/auditService.js';

export const basePath = '/tables';
const router = Router();

export const qrUrl = (t) => `${env.PUBLIC_CLIENT_URL}/t/${encodeURIComponent(t.number)}?k=${t.qrToken}`;
const dto = (t) => ({ id: String(t._id), number: t.number, name: t.name || undefined, capacity: t.capacity, section: t.section, active: Boolean(t.active), qrUrl: qrUrl(t) });

// Public: the page a guest lands on after scanning the QR code on their table.
router.get('/public/:number', limiter({ windowMs: 60_000, limit: 40 }), validate({ params: z.object({ number: z.string().trim().min(1).max(12) }), query: z.object({ k: z.string().trim().max(80).optional() }) }), async (req, res) => {
  const table = await Table.findOne({ number: req.valid.params.number, active: true }).lean();
  const given = req.valid.query.k ?? '';
  if (!table || !table.qrToken || !given || !safeEqual(table.qrToken, given)) throw notFound('This table link is not valid. Please scan the QR code on your table again, or ask a member of staff.');
  ok(res, { number: table.number, name: table.name || undefined, section: table.section, token: table.qrToken });
});

const shape = z.object({
  number: z.string().trim().min(1).max(12).regex(/^[A-Za-z0-9-]+$/, 'Use letters, numbers and hyphens'),
  name: z.string().trim().max(40).optional(),
  capacity: z.number().int().min(1).max(40),
  section: z.enum(TABLE_SECTIONS),
  active: z.boolean(),
});

router.get('/', requirePermission('tables:read'), async (_req, res) => {
  const rows = await Table.find({}).sort({ section: 1, number: 1 }).lean();
  ok(res, rows.map(dto));
});

router.post('/', requirePermission('tables:create'), validate({ body: shape.partial({ name: true, active: true }) }), async (req, res) => {
  if (await Table.exists({ number: req.valid.body.number })) throw conflict(`Table ${req.valid.body.number} already exists.`, 'NUMBER_TAKEN');
  const doc = await Table.create({ ...req.valid.body, qrToken: randomToken(12) });
  await audit(req, 'table.create', { type: 'table', id: doc._id }, `Created table ${doc.number}`);
  created(res, dto(doc));
});

router.put('/:id', requirePermission('tables:update'), validate({ params: z.object({ id: objectId }), body: shape.partial() }), async (req, res) => {
  const input = req.valid.body;
  if (input.number && (await Table.exists({ number: input.number, _id: { $ne: req.valid.params.id } }))) throw conflict(`Table ${input.number} already exists.`, 'NUMBER_TAKEN');
  if (input.active === false || (input.capacity != null)) {
    const clash = await Reservation.exists({ table: req.valid.params.id, status: { $in: ['pending', 'confirmed'] }, date: { $gte: dateKey() }, ...(input.capacity != null ? { guests: { $gt: input.capacity } } : {}) });
    if (clash) throw conflict('This table has upcoming bookings that would no longer fit. Move them first.', 'HAS_BOOKINGS');
  }
  const doc = await Table.findByIdAndUpdate(req.valid.params.id, { $set: input }, { new: true }).lean();
  if (!doc) throw notFound('Table not found.');
  await audit(req, 'table.update', { type: 'table', id: doc._id }, `Updated table ${doc.number}`, { fields: Object.keys(input) });
  ok(res, dto(doc));
});

router.post('/:id/regenerate-qr', requirePermission('tables:update'), validate({ params: z.object({ id: objectId }) }), async (req, res) => {
  const doc = await Table.findByIdAndUpdate(req.valid.params.id, { $set: { qrToken: randomToken(12) } }, { new: true }).lean();
  if (!doc) throw notFound('Table not found.');
  await audit(req, 'table.qr', { type: 'table', id: doc._id }, `Regenerated the QR code for table ${doc.number}`);
  ok(res, dto(doc));
});

router.delete('/:id', requirePermission('tables:delete'), validate({ params: z.object({ id: objectId }) }), async (req, res) => {
  if (await Reservation.exists({ table: req.valid.params.id, status: { $in: ['pending', 'confirmed'] }, date: { $gte: dateKey() } })) throw conflict('This table has upcoming bookings. Move or cancel them first.', 'HAS_BOOKINGS');
  const doc = await Table.findByIdAndDelete(req.valid.params.id);
  if (!doc) throw notFound('Table not found.');
  await audit(req, 'table.delete', { type: 'table', id: doc._id }, `Deleted table ${doc.number}`);
  ok(res, { deleted: true });
});

export default router;
