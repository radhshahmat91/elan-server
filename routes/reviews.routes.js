import { Router } from 'express';
import mongoose from 'mongoose';
import { MenuItem, Order, Review } from '../models/index.js';
import { REVIEW_STATUSES } from '../models/constants.js';
import { requireAuth, requirePermission } from '../middleware/auth.js';
import { limiter } from '../middleware/rateLimit.js';
import { objectId, validate, z } from '../middleware/validate.js';
import { conflict, forbidden, notFound } from '../utils/errors.js';
import { created, ok, pageMeta, parsePagination } from '../utils/http.js';
import { audit } from '../services/auditService.js';
import { notifyUser, notifyStaff } from '../services/notificationService.js';
import { recomputeItemRating, reviewableFor, serializeReview } from '../services/reviewService.js';

export const basePath = '/reviews';
const router = Router();

const ITEM_POPULATE = { path: 'menuItem', select: 'name nameBn slug' };

// Public ---------------------------------------------------------------------------------------------

const publicQuery = z.object({
  item: objectId.optional(),
  featured: z.enum(['1', 'true']).optional(),
  limit: z.coerce.number().int().min(1).max(24).optional(),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(30).default(10),
});

router.get('/', validate({ query: publicQuery }), async (req, res) => {
  const q = req.valid.query;
  const filter = { status: 'approved' };
  if (q.item) filter.menuItem = q.item;
  if (q.featured) {
    filter.rating = { $gte: 4 };
    filter.$expr = { $gte: [{ $strLenCP: '$body' }, 50] };
    const rows = await Review.find(filter).sort({ rating: -1, createdAt: -1 }).limit(q.limit ?? 6).populate(ITEM_POPULATE).lean();
    return ok(res, rows.map((r) => serializeReview(r)));
  }
  const { skip, limit, page, pageSize } = parsePagination(req.valid.query, { defaultSize: 10, maxSize: 30 });
  const [rows, total] = await Promise.all([Review.find(filter).sort({ createdAt: -1 }).skip(skip).limit(limit).populate(ITEM_POPULATE).lean(), Review.countDocuments(filter)]);
  return ok(res, rows.map((r) => serializeReview(r)), pageMeta({ page, pageSize }, total));
});

router.get('/summary', validate({ query: z.object({ item: objectId.optional() }) }), async (req, res) => {
  const match = { status: 'approved', ...(req.valid.query.item ? { menuItem: new mongoose.Types.ObjectId(req.valid.query.item) } : {}) };
  const rows = await Review.aggregate([{ $match: match }, { $group: { _id: '$rating', n: { $sum: 1 } } }]);
  const distribution = { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 };
  let count = 0;
  let sum = 0;
  for (const r of rows) {
    distribution[r._id] = r.n;
    count += r.n;
    sum += r._id * r.n;
  }
  ok(res, { count, avg: count ? Math.round((sum / count) * 10) / 10 : 0, distribution });
});

// Signed-in guests -----------------------------------------------------------------------------------

router.get('/mine', requireAuth, async (req, res) => {
  const [mine, reviewable] = await Promise.all([Review.find({ user: req.user._id }).sort({ createdAt: -1 }).limit(60).populate(ITEM_POPULATE).lean(), reviewableFor(req.user._id)]);
  ok(res, { reviews: mine.map((r) => ({ ...serializeReview(r), status: r.status })), reviewable });
});

const reviewBody = z.object({
  orderId: objectId,
  menuItemId: objectId.nullable().optional(),
  rating: z.number().int().min(1).max(5),
  title: z.string().trim().max(80).optional(),
  body: z.string().trim().min(10, 'Tell us a little more (at least 10 characters)').max(1200),
});

router.post('/', requireAuth, limiter({ windowMs: 10 * 60_000, limit: 10 }), validate({ body: reviewBody }), async (req, res) => {
  const input = req.valid.body;
  const order = await Order.findOne({ _id: input.orderId, user: req.user._id }).lean();
  if (!order) throw notFound('Order not found.');
  if (order.status !== 'delivered') throw forbidden('You can review an order once it has been delivered.', 'NOT_DELIVERED');
  if (input.menuItemId && !order.items.some((i) => String(i.menuItem) === input.menuItemId)) throw forbidden('That dish was not part of this order.', 'NOT_IN_ORDER');
  try {
    const doc = await Review.create({
      user: req.user._id,
      order: order._id,
      menuItem: input.menuItemId || null,
      rating: input.rating,
      title: input.title || undefined,
      body: input.body,
      authorName: req.user.name,
      status: 'pending',
    });
    await notifyStaff({ type: 'review', title: 'New review to moderate', body: `${input.rating} stars from ${req.user.name.split(' ')[0]}`, link: '/admin/reviews' }, { roles: ['manager', 'owner'] });
    created(res, { ...serializeReview(doc), status: doc.status });
  } catch (err) {
    if (err?.code === 11000) throw conflict('You have already reviewed this. Thank you!', 'ALREADY_REVIEWED');
    throw err;
  }
});

router.delete('/:id', requireAuth, validate({ params: z.object({ id: objectId }) }), async (req, res) => {
  const doc = await Review.findOneAndDelete({ _id: req.valid.params.id, user: req.user._id });
  if (!doc) throw notFound('Review not found.');
  await recomputeItemRating(doc.menuItem);
  ok(res, { deleted: true });
});

// Moderation -----------------------------------------------------------------------------------------

router.get('/admin/list', requirePermission('reviews:moderate'), validate({ query: z.object({ status: z.enum(REVIEW_STATUSES).optional(), page: z.coerce.number().int().min(1).default(1), pageSize: z.coerce.number().int().min(1).max(50).default(20) }) }), async (req, res) => {
  const filter = req.valid.query.status ? { status: req.valid.query.status } : {};
  const { skip, limit, page, pageSize } = parsePagination(req.valid.query, { defaultSize: 20, maxSize: 50 });
  const [rows, total, pending] = await Promise.all([
    Review.find(filter).sort({ status: 1, createdAt: -1 }).skip(skip).limit(limit).populate(ITEM_POPULATE).lean(),
    Review.countDocuments(filter),
    Review.countDocuments({ status: 'pending' }),
  ]);
  ok(res, rows.map((r) => serializeReview(r, { admin: true })), { ...pageMeta({ page, pageSize }, total), pending });
});

router.patch(
  '/admin/:id',
  requirePermission('reviews:moderate'),
  validate({ params: z.object({ id: objectId }), body: z.object({ status: z.enum(REVIEW_STATUSES).optional(), reply: z.string().trim().max(600).optional() }) }),
  async (req, res) => {
    const { status, reply } = req.valid.body;
    const set = {};
    if (status) set.status = status;
    if (reply !== undefined) set.reply = reply ? { text: reply, by: req.user.name, at: new Date() } : undefined;
    const before = await Review.findById(req.valid.params.id).lean();
    if (!before) throw notFound('Review not found.');
    const doc = await Review.findByIdAndUpdate(req.valid.params.id, reply === '' ? { $set: set, $unset: { reply: '' } } : { $set: set }, { new: true }).populate(ITEM_POPULATE).lean();
    if (status && status !== before.status) await recomputeItemRating(doc.menuItem?._id ?? null);
    await audit(req, 'review.moderate', { type: 'review', id: doc._id }, `Review ${status ?? 'reply'}: ${doc.rating} stars`, { status, replied: Boolean(reply) });
    if (status === 'approved' && before.status !== 'approved') {
      await notifyUser(doc.user, { type: 'review', title: 'Your review is live', body: 'Thank you for helping other guests choose.', link: '/account/reviews' });
    }
    ok(res, serializeReview(doc, { admin: true }));
  },
);

router.delete('/admin/:id', requirePermission('reviews:moderate'), validate({ params: z.object({ id: objectId }) }), async (req, res) => {
  const doc = await Review.findByIdAndDelete(req.valid.params.id);
  if (!doc) throw notFound('Review not found.');
  await recomputeItemRating(doc.menuItem);
  await audit(req, 'review.delete', { type: 'review', id: doc._id }, 'Deleted a review');
  ok(res, { deleted: true });
});

// Keeps MenuItem imported for the populate path (Mongoose needs the model registered).
void MenuItem;

export default router;
