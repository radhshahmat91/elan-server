// Administration of people: customers, the team, the permission matrix and the audit trail.
// Every route names its own permission. There is deliberately no router.use() guard here, because this router shares
// the /admin prefix with other routers that have different rules.
import { Router } from 'express';
import { AuditLog, LoyaltyTransaction, Order, Reservation, Review, User } from '../models/index.js';
import { USER_STATUSES } from '../models/constants.js';
import { requirePermission } from '../middleware/auth.js';
import { limiter } from '../middleware/rateLimit.js';
import { dateKey, email, objectId, phone, validate, z } from '../middleware/validate.js';
import { hashPassword, randomToken } from '../utils/crypto.js';
import { addDays, fromLocal } from '../utils/dates.js';
import { conflict, notFound } from '../utils/errors.js';
import { containsRegex, created, escapeRegex, ok, pageMeta, parsePagination } from '../utils/http.js';
import { can, STAFF_ROLES } from '../utils/permissions.js';
import { serializeUserAdmin } from '../serializers/user.js';
import { audit } from '../services/auditService.js';
import { grantPoints } from '../services/loyaltyService.js';
import {
  ASSIGNABLE_STAFF_ROLES,
  assertCustomer,
  assertStaffEditable,
  countByRole,
  issueSetupLink,
  permissionMatrix,
  revokeSessions,
} from '../services/accountService.js';

export const basePath = '/admin';
const router = Router();

const opt = (schema) => z.union([schema, z.literal('').transform(() => undefined)]).optional();

// Customers ------------------------------------------------------------------------------------------

const customerList = z.object({
  q: z.string().trim().max(80).optional(),
  status: z.enum(USER_STATUSES).optional(),
  tier: z.string().trim().max(24).optional(),
  sort: z.enum(['recent', 'name', 'points', 'lifetime', 'lastLogin']).default('recent'),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
});

const SORTS = {
  recent: { createdAt: -1 },
  name: { name: 1 },
  points: { 'loyalty.points': -1 },
  lifetime: { 'loyalty.lifetime': -1 },
  lastLogin: { lastLoginAt: -1 },
};

router.get('/customers', requirePermission('customers:read'), validate({ query: customerList }), async (req, res) => {
  const q = req.valid.query;
  const filter = { role: 'customer', status: q.status ?? { $ne: 'deleted' } };
  if (q.tier) filter['loyalty.tier'] = q.tier;
  if (q.q) {
    const re = containsRegex(q.q);
    filter.$or = [{ name: re }, { email: re }, { phone: re }];
  }
  const { skip, limit, page, pageSize } = parsePagination(req.valid.query, { defaultSize: 20, maxSize: 100 });
  const [users, total] = await Promise.all([User.find(filter).sort(SORTS[q.sort]).skip(skip).limit(limit).lean(), User.countDocuments(filter)]);
  const stats = users.length
    ? await Order.aggregate([
        { $match: { user: { $in: users.map((u) => u._id) }, status: 'delivered' } },
        { $group: { _id: '$user', orders: { $sum: 1 }, spent: { $sum: '$totals.total' }, lastOrderAt: { $max: '$createdAt' } } },
      ])
    : [];
  const byUser = new Map(stats.map((s) => [String(s._id), s]));
  ok(
    res,
    users.map((u) => {
      const s = byUser.get(String(u._id));
      return serializeUserAdmin(u, { orders: s?.orders ?? 0, spent: s?.spent ?? 0, lastOrderAt: s?.lastOrderAt });
    }),
    pageMeta({ page, pageSize }, total),
  );
});

router.get('/customers/:id', requirePermission('customers:read'), validate({ params: z.object({ id: objectId }) }), async (req, res) => {
  const user = await User.findById(req.valid.params.id).lean();
  if (!user || user.role !== 'customer') throw notFound('Customer not found.');
  const [orders, delivered, cancelled, spendRow, reservations, reviews, ledger] = await Promise.all([
    Order.find({ user: user._id }).sort({ createdAt: -1 }).limit(10).lean(),
    Order.countDocuments({ user: user._id, status: 'delivered' }),
    Order.countDocuments({ user: user._id, status: { $in: ['cancelled', 'rejected'] } }),
    Order.aggregate([{ $match: { user: user._id, status: 'delivered' } }, { $group: { _id: null, spent: { $sum: '$totals.total' }, last: { $max: '$createdAt' } } }]),
    Reservation.find({ user: user._id }).sort({ startsAt: -1 }).limit(8).lean(),
    Review.countDocuments({ user: user._id }),
    LoyaltyTransaction.find({ user: user._id }).sort({ createdAt: -1 }).limit(20).lean(),
  ]);
  const spent = spendRow[0]?.spent ?? 0;
  ok(res, {
    customer: serializeUserAdmin(user),
    stats: { delivered, cancelled, spent, averageOrder: delivered ? Math.round(spent / delivered) : 0, lastOrderAt: spendRow[0]?.last, reservations: reservations.length, reviews },
    orders: orders.map((o) => ({ id: String(o._id), publicId: o.publicId, orderNumber: o.orderNumber, status: o.status, fulfillment: o.fulfillment, total: o.totals?.total ?? 0, itemCount: (o.items ?? []).reduce((n, i) => n + (i.quantity ?? 0), 0), createdAt: o.createdAt })),
    reservations: reservations.map((r) => ({ id: String(r._id), code: r.code, status: r.status, date: r.date, time: r.seating, guests: r.guests })),
    ledger: ledger.map((l) => ({ id: String(l._id), type: l.type, points: l.points, balanceAfter: l.balanceAfter, note: l.note || undefined, createdAt: l.createdAt })),
  });
});

router.patch(
  '/customers/:id',
  requirePermission('customers:update'),
  validate({ params: z.object({ id: objectId }), body: z.object({ status: z.enum(['active', 'suspended']) }) }),
  async (req, res) => {
    const target = await User.findById(req.valid.params.id);
    if (!target) throw notFound('Customer not found.');
    assertCustomer(target);
    if (target.status === 'deleted') throw conflict('This account was deleted by its owner.', 'ACCOUNT_DELETED');
    const { status } = req.valid.body;
    if (target.status !== status) {
      await User.updateOne({ _id: target._id }, { $set: { status } });
      if (status === 'suspended') await revokeSessions(target._id);
      await audit(req, `customer.${status === 'suspended' ? 'suspend' : 'reinstate'}`, { type: 'user', id: target._id }, `${status === 'suspended' ? 'Suspended' : 'Reinstated'} ${target.name}`);
    }
    ok(res, serializeUserAdmin(await User.findById(target._id)));
  },
);

router.post(
  '/customers/:id/points',
  requirePermission('loyalty:adjust'),
  limiter({ windowMs: 10 * 60_000, limit: 40 }),
  validate({
    params: z.object({ id: objectId }),
    body: z.object({ points: z.number().int().min(-10_000).max(10_000), note: z.string().trim().min(3, 'Say why, so the ledger makes sense later').max(160) }),
  }),
  async (req, res) => {
    const target = await User.findById(req.valid.params.id).select('role name status').lean();
    if (!target) throw notFound('Customer not found.');
    assertCustomer(target);
    const { points, note } = req.valid.body;
    const result = await grantPoints({ userId: target._id, points, type: 'adjust', note, createdBy: req.user._id });
    await audit(req, 'loyalty.adjust', { type: 'user', id: target._id }, `${points > 0 ? '+' : ''}${points} points for ${target.name}`, { note, balance: result.balance });
    ok(res, result);
  },
);

// Team -----------------------------------------------------------------------------------------------

router.get('/staff', requirePermission('staff:read'), async (req, res) => {
  const users = await User.find({ role: { $in: STAFF_ROLES }, status: { $ne: 'deleted' } }).sort({ role: 1, name: 1 }).lean();
  const canManage = can(req.user.role, 'staff:update');
  ok(
    res,
    users.map((u) => ({ ...serializeUserAdmin(u), editable: canManage && u.role !== 'owner' && String(u._id) !== String(req.user._id) })),
    { counts: await countByRole() },
  );
});

const staffBody = z.object({
  name: z.string().trim().min(2, 'Enter a name').max(80),
  email,
  phone: opt(phone),
  role: z.enum(ASSIGNABLE_STAFF_ROLES),
});

router.post('/staff', requirePermission('staff:update'), limiter({ windowMs: 10 * 60_000, limit: 20 }), validate({ body: staffBody }), async (req, res) => {
  const input = req.valid.body;
  if (await User.exists({ email: input.email })) throw conflict('An account with this email already exists.', 'EMAIL_TAKEN');
  let user;
  try {
    // Nobody knows this password: the person chooses theirs through the one-time link.
    user = await User.create({ name: input.name, email: input.email, phone: input.phone, role: input.role, status: 'active', passwordHash: await hashPassword(randomToken(24)) });
  } catch (err) {
    if (err?.code === 11000) throw conflict('An account with this email already exists.', 'EMAIL_TAKEN');
    throw err;
  }
  const link = await issueSetupLink(user, { hours: 48, reason: 'setup' });
  await audit(req, 'staff.create', { type: 'user', id: user._id }, `Created ${input.role} account for ${user.name}`, { role: input.role });
  created(res, { staff: serializeUserAdmin(user), setupUrl: link.url, setupExpiresAt: link.expiresAt });
});

router.patch(
  '/staff/:id',
  requirePermission('staff:update'),
  validate({
    params: z.object({ id: objectId }),
    body: z.object({ name: z.string().trim().min(2).max(80), phone: opt(phone), role: z.enum(ASSIGNABLE_STAFF_ROLES), status: z.enum(['active', 'suspended']) }).partial(),
  }),
  async (req, res) => {
    const target = await User.findById(req.valid.params.id);
    if (!target) throw notFound('Staff member not found.');
    assertStaffEditable(req.user, target);
    const input = req.valid.body;
    const set = {};
    for (const key of ['name', 'phone', 'role', 'status']) if (input[key] !== undefined) set[key] = input[key];
    if (Object.keys(set).length) {
      await User.updateOne({ _id: target._id }, { $set: set });
      if (set.status === 'suspended' || (set.role && set.role !== target.role)) await revokeSessions(target._id);
      const changes = [set.role && set.role !== target.role ? `role ${target.role} to ${set.role}` : null, set.status && set.status !== target.status ? `status ${set.status}` : null].filter(Boolean);
      await audit(req, 'staff.update', { type: 'user', id: target._id }, `Updated ${target.name}${changes.length ? `: ${changes.join(', ')}` : ''}`, { fields: Object.keys(set) });
    }
    ok(res, serializeUserAdmin(await User.findById(target._id)));
  },
);

router.post('/staff/:id/reset-password', requirePermission('staff:update'), limiter({ windowMs: 10 * 60_000, limit: 20 }), validate({ params: z.object({ id: objectId }) }), async (req, res) => {
  const target = await User.findById(req.valid.params.id);
  if (!target) throw notFound('Staff member not found.');
  assertStaffEditable(req.user, target);
  await revokeSessions(target._id);
  const link = await issueSetupLink(target, { hours: 24, reason: 'reset' });
  await audit(req, 'staff.reset_password', { type: 'user', id: target._id }, `Issued a password reset link for ${target.name}`);
  ok(res, { setupUrl: link.url, setupExpiresAt: link.expiresAt });
});

router.get('/roles', requirePermission('staff:read'), (_req, res) => ok(res, permissionMatrix()));

// Audit trail ----------------------------------------------------------------------------------------

const auditQuery = z.object({
  action: z.string().trim().max(40).optional(),
  actor: objectId.optional(),
  q: z.string().trim().max(80).optional(),
  from: dateKey.optional(),
  to: dateKey.optional(),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(30),
});

router.get('/audit', requirePermission('audit:read'), validate({ query: auditQuery }), async (req, res) => {
  const q = req.valid.query;
  const filter = {};
  if (q.action) filter.action = new RegExp(`^${escapeRegex(q.action)}`);
  if (q.actor) filter['actor.id'] = q.actor;
  if (q.q) filter.summary = containsRegex(q.q);
  if (q.from || q.to) filter.at = { ...(q.from ? { $gte: fromLocal(q.from) } : {}), ...(q.to ? { $lt: fromLocal(addDays(q.to, 1)) } : {}) };
  const { skip, limit, page, pageSize } = parsePagination(req.valid.query, { defaultSize: 30, maxSize: 100 });
  const [rows, total] = await Promise.all([AuditLog.find(filter).sort({ at: -1 }).skip(skip).limit(limit).lean(), AuditLog.countDocuments(filter)]);
  const seesIp = req.user.role === 'owner';
  ok(
    res,
    rows.map((r) => ({
      id: String(r._id),
      at: r.at,
      actor: { id: r.actor?.id ? String(r.actor.id) : undefined, name: r.actor?.name ?? 'System', role: r.actor?.role ?? 'system' },
      action: r.action,
      entity: r.entity?.type ? { type: r.entity.type, id: r.entity.id } : undefined,
      summary: r.summary,
      meta: r.meta ?? undefined,
      ip: seesIp ? r.ip : undefined,
    })),
    pageMeta({ page, pageSize }, total),
  );
});

router.get('/audit/actions', requirePermission('audit:read'), async (_req, res) => {
  const actions = await AuditLog.distinct('action');
  ok(res, actions.filter(Boolean).sort());
});

export default router;
