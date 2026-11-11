// Staff operations on orders: the order list, the kitchen board, deliveries, status changes, assignment and refunds.
import { Router } from 'express';
import { Order, User } from '../models/index.js';
import { ACTIVE_ORDER_STATUSES, FULFILLMENT, ORDER_STATUSES, PAYMENT_STATUSES } from '../models/constants.js';
import { requirePermission, requireRole } from '../middleware/auth.js';
import { dateKey, objectId, validate, z } from '../middleware/validate.js';
import { conflict, notFound } from '../utils/errors.js';
import { containsRegex, ok, pageMeta, parsePagination } from '../utils/http.js';
import { addDays, fromLocal, startOfLocalDay } from '../utils/dates.js';
import { byIdOrPublicId } from '../utils/lookup.js';
import { audit } from '../services/auditService.js';
import { assignDelivery, serializeOrder, transitionOrder } from '../services/orderService.js';
import { refundPayment } from '../services/paymentService.js';
import { emitOrderUpdate } from '../services/orderEvents.js';

export const basePath = '/staff';
const router = Router();

const STAFF_POPULATE = { path: 'assignedDelivery', select: 'name' };
const asActor = (req) => ({ id: req.user._id, name: req.user.name, role: req.user.role });
const idParams = z.object({ id: z.string().trim().min(8).max(40) });

async function loadOrder(ref, { lean = false } = {}) {
  const query = Order.findOne(byIdOrPublicId(ref));
  const order = await (lean ? query.populate(STAFF_POPULATE).lean() : query);
  if (!order) throw notFound('Order not found.');
  return order;
}

// Orders list ------------------------------------------------------------------------------------------

const listQuery = z.object({
  status: z.string().trim().max(120).optional(), // csv of statuses, or "active" / "final"
  fulfillment: z.enum(FULFILLMENT).optional(),
  payment: z.enum(PAYMENT_STATUSES).optional(),
  q: z.string().trim().max(80).optional(),
  from: dateKey.optional(),
  to: dateKey.optional(),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(25),
});

router.get('/orders', requirePermission('orders:read'), validate({ query: listQuery }), async (req, res) => {
  const q = req.valid.query;
  const filter = {};
  if (q.status === 'active') filter.status = { $in: ACTIVE_ORDER_STATUSES };
  else if (q.status === 'final') filter.status = { $in: ['delivered', 'cancelled', 'rejected'] };
  else if (q.status) {
    const wanted = q.status.split(',').map((s) => s.trim()).filter((s) => ORDER_STATUSES.includes(s));
    if (wanted.length) filter.status = { $in: wanted };
  }
  if (q.fulfillment) filter.fulfillment = q.fulfillment;
  if (q.payment) filter['payment.status'] = q.payment;
  if (q.from || q.to) {
    filter.createdAt = {};
    if (q.from) filter.createdAt.$gte = fromLocal(q.from, '00:00');
    if (q.to) filter.createdAt.$lt = fromLocal(addDays(q.to, 1), '00:00');
  }
  if (q.q) {
    const re = containsRegex(q.q);
    filter.$or = [{ orderNumber: re }, { 'customer.name': re }, { 'customer.phone': re }, { 'customer.email': re }];
  }
  const { skip, limit, page, pageSize } = parsePagination(req.valid.query, { defaultSize: 25, maxSize: 100 });
  const [rows, total] = await Promise.all([
    Order.find(filter).sort({ createdAt: -1 }).skip(skip).limit(limit).populate(STAFF_POPULATE).lean(),
    Order.countDocuments(filter),
  ]);
  ok(res, rows.map((o) => serializeOrder(o, 'staff')), pageMeta({ page, pageSize }, total));
});

router.get('/orders/:id', requirePermission('orders:read'), validate({ params: idParams }), async (req, res) => {
  ok(res, serializeOrder(await loadOrder(req.valid.params.id, { lean: true }), 'staff'));
});

// Status changes: canTransition() decides who may do what, so any staff permission can reach this route ----

router.patch(
  '/orders/:id/status',
  requirePermission('orders:update', 'orders:progress', 'deliveries:update'),
  validate({ params: idParams, body: z.object({ status: z.enum(ORDER_STATUSES), note: z.string().trim().max(300).optional(), reason: z.string().trim().max(200).optional() }) }),
  async (req, res) => {
    const order = await loadOrder(req.valid.params.id);
    // A rider may only touch deliveries that are theirs or still unassigned (canTransition enforces the rest).
    const { status, note, reason } = req.valid.body;
    const before = order.status;
    const updated = await transitionOrder({ order, toStatus: status, actor: asActor(req), note, reason });
    if (['owner', 'manager'].includes(req.user.role)) await audit(req, 'order.status', { type: 'order', id: updated._id }, `${updated.orderNumber}: ${before} to ${status}`, { note, reason });
    const populated = await Order.findById(updated._id).populate(STAFF_POPULATE).lean();
    ok(res, serializeOrder(populated, 'staff'));
  },
);

router.post('/orders/:id/assign', requirePermission('orders:assign'), validate({ params: idParams, body: z.object({ riderId: objectId }) }), async (req, res) => {
  const order = await loadOrder(req.valid.params.id);
  const updated = await assignDelivery({ order, riderId: req.valid.body.riderId, actor: asActor(req) });
  await audit(req, 'order.assign', { type: 'order', id: updated._id }, `${updated.orderNumber} assigned to a rider`);
  ok(res, serializeOrder(await Order.findById(updated._id).populate(STAFF_POPULATE).lean(), 'staff'));
});

router.post(
  '/orders/:id/refund',
  requirePermission('payments:refund'),
  validate({ params: idParams, body: z.object({ amount: z.number().int().min(1).max(1_000_000).optional(), reason: z.string().trim().min(3, 'Give a short reason').max(200) }) }),
  async (req, res) => {
    const order = await loadOrder(req.valid.params.id);
    if (order.payment.provider !== 'sandbox') throw conflict('Only online payments can be refunded here. Cash orders are settled at the counter.', 'NOT_ONLINE');
    const result = await refundPayment(order, { amount: req.valid.body.amount, reason: req.valid.body.reason, actor: asActor(req) });
    const fresh = await Order.findById(order._id);
    emitOrderUpdate(fresh);
    await audit(req, 'order.refund', { type: 'order', id: order._id }, `Refunded ৳${result.refunded} on ${order.orderNumber}`, { reason: req.valid.body.reason });
    ok(res, { ...result, order: serializeOrder(await Order.findById(order._id).populate(STAFF_POPULATE).lean(), 'staff') });
  },
);

// Kitchen board ----------------------------------------------------------------------------------------

router.get('/kitchen', requirePermission('kitchen:view'), async (_req, res) => {
  const since = startOfLocalDay();
  const [live, doneToday] = await Promise.all([
    Order.find({ status: { $in: ['placed', 'confirmed', 'preparing', 'ready'] } }).sort({ createdAt: 1 }).limit(120).populate(STAFF_POPULATE).lean(),
    Order.countDocuments({ status: { $in: ['delivered'] }, deliveredAt: { $gte: since } }),
  ]);
  const count = (status) => live.filter((o) => o.status === status).length;
  ok(res, {
    orders: live.map((o) => serializeOrder(o, 'staff')),
    stats: { placed: count('placed'), confirmed: count('confirmed'), preparing: count('preparing'), ready: count('ready'), completedToday: doneToday },
  });
});

// Deliveries -------------------------------------------------------------------------------------------

router.get('/deliveries', requireRole('delivery', 'manager', 'owner'), async (req, res) => {
  const isRider = req.user.role === 'delivery';
  const since = startOfLocalDay();
  const [available, mine, recent] = await Promise.all([
    Order.find({ fulfillment: 'delivery', status: 'ready', assignedDelivery: null }).sort({ readyAt: 1 }).limit(50).populate(STAFF_POPULATE).lean(),
    Order.find({ fulfillment: 'delivery', status: { $in: ['ready', 'out_for_delivery'] }, ...(isRider ? { assignedDelivery: req.user._id } : { assignedDelivery: { $ne: null } }) })
      .sort({ readyAt: 1 })
      .limit(50)
      .populate(STAFF_POPULATE)
      .lean(),
    Order.find({ fulfillment: 'delivery', status: 'delivered', deliveredAt: { $gte: since }, ...(isRider ? { assignedDelivery: req.user._id } : {}) })
      .sort({ deliveredAt: -1 })
      .limit(30)
      .populate(STAFF_POPULATE)
      .lean(),
  ]);
  ok(res, { available: available.map((o) => serializeOrder(o, 'staff')), mine: mine.map((o) => serializeOrder(o, 'staff')), recent: recent.map((o) => serializeOrder(o, 'staff')) });
});

router.get('/riders', requirePermission('orders:assign'), async (_req, res) => {
  const riders = await User.find({ role: 'delivery', status: 'active' }).sort({ name: 1 }).select('name phone').lean();
  const busy = await Order.aggregate([{ $match: { status: { $in: ['ready', 'out_for_delivery'] }, assignedDelivery: { $ne: null } } }, { $group: { _id: '$assignedDelivery', n: { $sum: 1 } } }]);
  const load = new Map(busy.map((b) => [String(b._id), b.n]));
  ok(res, riders.map((r) => ({ id: String(r._id), name: r.name, phone: r.phone || undefined, activeDeliveries: load.get(String(r._id)) ?? 0 })));
});

export default router;
