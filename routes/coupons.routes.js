import { Router } from 'express';
import { Coupon } from '../models/index.js';
import { COUPON_TYPES, FULFILLMENT } from '../models/constants.js';
import { requirePermission } from '../middleware/auth.js';
import { limiter } from '../middleware/rateLimit.js';
import { objectId, validate, z } from '../middleware/validate.js';
import { conflict, notFound } from '../utils/errors.js';
import { created, ok } from '../utils/http.js';
import { audit } from '../services/auditService.js';
import { evaluateCoupon } from '../services/couponService.js';
import { getRestaurant } from '../services/restaurantService.js';

export const basePath = '/coupons';
const router = Router();

// Public: does this code work for this basket? The authoritative check happens again at checkout.
router.post(
  '/validate',
  limiter({ windowMs: 60_000, limit: 20, message: 'Too many code checks. Please wait a minute.' }),
  validate({ body: z.object({ code: z.string().trim().min(1).max(24), subtotal: z.number().int().min(0).max(1_000_000), fulfillment: z.enum(FULFILLMENT).default('delivery') }) }),
  async (req, res) => {
    const { code, subtotal, fulfillment } = req.valid.body;
    const restaurant = await getRestaurant();
    const deliveryFee = fulfillment === 'delivery' && subtotal < restaurant.delivery.freeOver ? restaurant.delivery.baseFee : 0;
    const result = await evaluateCoupon(code, { subtotal, deliveryFee, fulfillment, userId: req.user ? String(req.user._id) : null });
    ok(res, result.valid ? { valid: true, code: result.code, discount: result.discount, freeDelivery: result.freeDelivery, description: result.coupon.description } : { valid: false, reason: result.reason, message: result.message });
  },
);

// ---- Admin CRUD (mounted from the same file under /api/coupons/admin) -------------------------------

const text = (max) => z.union([z.string().trim().max(max), z.literal('')]).optional();
const shape = z.object({
  code: z.string().trim().toUpperCase().regex(/^[A-Z0-9-]{3,24}$/, 'Use 3 to 24 letters, numbers or hyphens'),
  description: text(200),
  type: z.enum(COUPON_TYPES),
  value: z.number().min(0).max(100000),
  maxDiscount: z.number().int().min(0).max(100000).nullable().optional(),
  minOrder: z.number().int().min(0).max(1_000_000),
  startsAt: z.string().datetime().nullable().optional(),
  expiresAt: z.string().datetime().nullable().optional(),
  usageLimit: z.number().int().min(1).max(1_000_000).nullable().optional(),
  perUserLimit: z.number().int().min(0).max(1000),
  firstOrderOnly: z.boolean(),
  appliesTo: z.array(z.enum(FULFILLMENT)).max(3),
  active: z.boolean(),
  showOnSite: z.boolean(),
  headline: text(80),
  terms: text(300),
});
const rules = (c) => (c.type !== 'percent' || c.value == null || (c.value >= 1 && c.value <= 100)) && (!c.startsAt || !c.expiresAt || new Date(c.startsAt) < new Date(c.expiresAt));
const RULE_MESSAGE = { message: 'Percent codes take 1 to 100, and the start must come before the end', path: ['value'] };
const create = shape.partial({ description: true, maxDiscount: true, minOrder: true, startsAt: true, expiresAt: true, usageLimit: true, perUserLimit: true, firstOrderOnly: true, appliesTo: true, active: true, showOnSite: true, headline: true, terms: true }).refine(rules, RULE_MESSAGE);
const update = shape.partial().refine(rules, RULE_MESSAGE);

const dto = (c) => ({
  id: String(c._id),
  code: c.code,
  description: c.description || undefined,
  type: c.type,
  value: c.value,
  maxDiscount: c.maxDiscount ?? null,
  minOrder: c.minOrder ?? 0,
  startsAt: c.startsAt ?? null,
  expiresAt: c.expiresAt ?? null,
  usageLimit: c.usageLimit ?? null,
  perUserLimit: c.perUserLimit ?? 0,
  usedCount: c.usedCount ?? 0,
  firstOrderOnly: Boolean(c.firstOrderOnly),
  appliesTo: c.appliesTo ?? [],
  active: Boolean(c.active),
  showOnSite: Boolean(c.showOnSite),
  headline: c.headline || undefined,
  terms: c.terms || undefined,
  createdAt: c.createdAt,
});

const clean = (input) => {
  const out = { ...input };
  for (const key of ['description', 'headline', 'terms']) if (out[key] === '') out[key] = undefined;
  if (out.startsAt) out.startsAt = new Date(out.startsAt);
  if (out.expiresAt) out.expiresAt = new Date(out.expiresAt);
  if (out.type === 'free_delivery') out.value = 0;
  return out;
};

router.get('/admin', requirePermission('coupons:read'), async (_req, res) => {
  const rows = await Coupon.find({}).select('-redemptions').sort({ createdAt: -1 }).lean();
  ok(res, rows.map(dto));
});

router.post('/admin', requirePermission('coupons:create'), validate({ body: create }), async (req, res) => {
  const input = clean(req.valid.body);
  if (await Coupon.exists({ code: input.code })) throw conflict('A coupon with that code already exists.', 'CODE_TAKEN');
  const doc = await Coupon.create({ perUserLimit: 1, ...input });
  await audit(req, 'coupon.create', { type: 'coupon', id: doc._id }, `Created coupon ${doc.code}`);
  created(res, dto(doc.toObject()));
});

router.put('/admin/:id', requirePermission('coupons:update'), validate({ params: z.object({ id: objectId }), body: update }), async (req, res) => {
  const input = clean(req.valid.body);
  const set = {};
  const unset = {};
  for (const [key, value] of Object.entries(input)) (value === undefined ? unset : set)[key] = value === undefined ? '' : value;
  const op = { ...(Object.keys(set).length ? { $set: set } : {}), ...(Object.keys(unset).length ? { $unset: unset } : {}) };
  const doc = Object.keys(op).length ? await Coupon.findByIdAndUpdate(req.valid.params.id, op, { new: true }).select('-redemptions').lean() : await Coupon.findById(req.valid.params.id).select('-redemptions').lean();
  if (!doc) throw notFound('Coupon not found.');
  await audit(req, 'coupon.update', { type: 'coupon', id: doc._id }, `Updated coupon ${doc.code}`, { fields: Object.keys(input) });
  ok(res, dto(doc));
});

// A coupon that has been used stays for the records; it is switched off instead of deleted.
router.delete('/admin/:id', requirePermission('coupons:delete'), validate({ params: z.object({ id: objectId }) }), async (req, res) => {
  const doc = await Coupon.findById(req.valid.params.id).select('code usedCount');
  if (!doc) throw notFound('Coupon not found.');
  if (doc.usedCount > 0) {
    await Coupon.updateOne({ _id: doc._id }, { $set: { active: false, showOnSite: false } });
    await audit(req, 'coupon.deactivate', { type: 'coupon', id: doc._id }, `Deactivated used coupon ${doc.code}`);
    return ok(res, { deleted: false, deactivated: true });
  }
  await Coupon.deleteOne({ _id: doc._id });
  await audit(req, 'coupon.delete', { type: 'coupon', id: doc._id }, `Deleted coupon ${doc.code}`);
  return ok(res, { deleted: true });
});

export default router;
