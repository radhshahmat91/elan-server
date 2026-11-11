import { Router } from 'express';
import { Order } from '../models/index.js';
import { FULFILLMENT, PAYMENT_METHODS } from '../models/constants.js';
import { limiter } from '../middleware/rateLimit.js';
import { email, objectId, phone, validate, z } from '../middleware/validate.js';
import { notFound } from '../utils/errors.js';
import { created, ok } from '../utils/http.js';
import { cancelOrder, createOrder, restartPayment, serializeOrder } from '../services/orderService.js';
import { cartLine } from './cart.routes.js';

export const basePath = '/orders';
const router = Router();

const emptyToUndefined = (schema) => z.union([schema, z.literal('').transform(() => undefined)]).optional();

const orderBody = z.object({
  items: z.array(cartLine).min(1, 'Your cart is empty').max(40),
  fulfillment: z.enum(FULFILLMENT),
  paymentMethod: z.enum(PAYMENT_METHODS),
  customer: z
    .object({
      name: z.string().trim().min(2, 'Enter your name').max(80).optional(),
      phone: emptyToUndefined(phone),
      email: emptyToUndefined(email),
    })
    .optional(),
  address: z
    .object({
      label: z.string().trim().max(30).optional(),
      recipient: z.string().trim().max(80).optional(),
      line1: z.string().trim().min(3, 'Enter your street address').max(160),
      area: z.string().trim().min(2, 'Choose your area').max(80),
      city: z.string().trim().max(60).optional(),
      notes: z.string().trim().max(200).optional(),
    })
    .optional(),
  addressId: objectId.optional(),
  saveAddress: z.boolean().optional(),
  tableNumber: z.string().trim().max(12).optional(),
  tableToken: z.string().trim().max(80).optional(),
  notes: z.string().trim().max(400).optional(),
  couponCode: z.string().trim().max(24).optional(),
  loyaltyPoints: z.number().int().min(0).max(1_000_000).optional(),
  scheduledFor: z.string().datetime().optional(),
  idempotencyKey: z.string().trim().min(8).max(80).optional(),
});

/** Whoever holds the unguessable tracking id can see the public view; the owner sees more. */
async function loadByPublicId(publicId) {
  const order = await Order.findOne({ publicId: String(publicId) });
  if (!order) throw notFound('We could not find that order. Check the link and try again.');
  return order;
}
const isOwner = (req, order) => Boolean(req.user && order.user && String(order.user) === String(req.user._id));
const actorFor = (req) => (req.user ? { id: req.user._id, name: req.user.name, role: 'customer' } : { name: 'Guest', role: 'guest' });

router.post('/', limiter({ windowMs: 60_000, limit: 15, message: 'You are placing orders very quickly. Please wait a moment.' }), validate({ body: orderBody }), async (req, res) => {
  const { order, payment, replayed } = await createOrder({ input: req.valid.body, user: req.user });
  created(res, { order: serializeOrder(order, 'owner'), payment, replayed: Boolean(replayed) });
});

router.get('/track/:publicId', async (req, res) => {
  const order = await loadByPublicId(req.params.publicId);
  ok(res, serializeOrder(order, isOwner(req, order) ? 'owner' : 'public'));
});

// "I lost my link": order number plus the phone number used at checkout.
router.post(
  '/lookup',
  limiter({ windowMs: 10 * 60_000, limit: 15, message: 'Too many lookups. Please wait a few minutes.' }),
  validate({ body: z.object({ orderNumber: z.string().trim().toUpperCase().min(6).max(24), phone }) }),
  async (req, res) => {
    const { orderNumber, phone: given } = req.valid.body;
    const digits = (value) => String(value ?? '').replace(/\D/g, '').slice(-9);
    const order = await Order.findOne({ orderNumber }).select('publicId customer.phone').lean();
    if (!order || digits(order.customer?.phone) !== digits(given)) throw notFound('No order matches that number and phone. Check both and try again.');
    ok(res, { publicId: order.publicId });
  },
);

router.post(
  '/:publicId/cancel',
  limiter({ windowMs: 60_000, limit: 10 }),
  validate({ body: z.object({ reason: z.string().trim().max(200).optional() }) }),
  async (req, res) => {
    const order = await loadByPublicId(req.params.publicId);
    // An order that belongs to an account can only be cancelled by that account.
    const updated = await cancelOrder({ order, actor: actorFor(req), reason: req.valid.body.reason });
    ok(res, serializeOrder(updated, 'owner'));
  },
);

router.post('/:publicId/pay', limiter({ windowMs: 60_000, limit: 10 }), async (req, res) => {
  const order = await loadByPublicId(req.params.publicId);
  if (order.user && !isOwner(req, order)) throw notFound('We could not find that order. Check the link and try again.');
  ok(res, { payment: await restartPayment(order) });
});

export default router;
