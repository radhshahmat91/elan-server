// The signed-in customer's own data: profile, addresses, favourites, orders, notifications, rewards, account deletion.
import { Router } from 'express';
import { Address, Cart, MenuItem, Notification, Order, Session, User } from '../models/index.js';
import { requireAuth } from '../middleware/auth.js';
import { limiter } from '../middleware/rateLimit.js';
import { dateKey, objectId, phone, validate, z } from '../middleware/validate.js';
import { conflict, notFound, unauthorized } from '../utils/errors.js';
import { ok, created, pageMeta, parsePagination } from '../utils/http.js';
import { verifyPassword } from '../utils/crypto.js';
import { byIdOrPublicId } from '../utils/lookup.js';
import { serializeAddress, serializeUser } from '../serializers/user.js';
import { serializeMenuItem } from '../serializers/menu.js';
import { serializeOrder } from '../serializers/order.js';
import { serializeNotification } from '../services/notificationService.js';
import { getLoyaltySummary } from '../services/loyaltyService.js';
import { audit } from '../services/auditService.js';

export const basePath = '/me';
const router = Router();
router.use(requireAuth);

const blank = (schema) => z.union([schema, z.literal('')]);

// Profile ----------------------------------------------------------------------------------------------

const profileBody = z
  .object({
    name: z.string().trim().min(2, 'Enter your name').max(80),
    phone: blank(phone).nullable(),
    birthday: blank(dateKey).nullable(),
    marketingOptIn: z.boolean(),
    avatarUrl: blank(z.string().trim().max(500)).nullable(),
    notificationPrefs: z.object({ orderUpdates: z.boolean(), reservationUpdates: z.boolean(), promotions: z.boolean() }).partial(),
  })
  .partial();

router.patch('/', validate({ body: profileBody }), async (req, res) => {
  const input = req.valid.body;
  const set = {};
  const unset = {};
  for (const key of ['name', 'marketingOptIn']) if (input[key] !== undefined) set[key] = input[key];
  for (const key of ['phone', 'avatarUrl']) {
    if (input[key] === undefined) continue;
    if (input[key] === '' || input[key] === null) unset[key] = '';
    else set[key] = input[key];
  }
  if (input.birthday !== undefined) {
    if (input.birthday === '' || input.birthday === null) unset.birthday = '';
    else set.birthday = new Date(`${input.birthday}T00:00:00Z`);
  }
  for (const [key, value] of Object.entries(input.notificationPrefs ?? {})) set[`notificationPrefs.${key}`] = value;
  if (input.marketingOptIn !== undefined && input.notificationPrefs?.promotions === undefined) set['notificationPrefs.promotions'] = input.marketingOptIn;
  const update = { ...(Object.keys(set).length ? { $set: set } : {}), ...(Object.keys(unset).length ? { $unset: unset } : {}) };
  const user = Object.keys(update).length ? await User.findByIdAndUpdate(req.user._id, update, { new: true }) : await User.findById(req.user._id);
  ok(res, { user: serializeUser(user) });
});

router.get('/loyalty', async (req, res) => ok(res, await getLoyaltySummary(req.user._id)));

// Addresses --------------------------------------------------------------------------------------------

const addressBody = z.object({
  label: z.string().trim().min(1).max(30),
  recipient: z.string().trim().max(80).optional(),
  phone: blank(phone).optional(),
  line1: z.string().trim().min(3, 'Enter your street address').max(160),
  area: z.string().trim().min(2, 'Enter your area').max(80),
  city: z.string().trim().min(2).max(60).default('Dhaka'),
  postcode: z.string().trim().max(12).optional(),
  notes: z.string().trim().max(200).optional(),
  isDefault: z.boolean().default(false),
});

router.get('/addresses', async (req, res) => {
  const rows = await Address.find({ user: req.user._id }).sort({ isDefault: -1, createdAt: 1 }).lean();
  ok(res, rows.map(serializeAddress));
});

router.post('/addresses', validate({ body: addressBody }), async (req, res) => {
  const count = await Address.countDocuments({ user: req.user._id });
  if (count >= 8) throw conflict('You can keep up to 8 saved addresses. Remove one to add another.', 'TOO_MANY_ADDRESSES');
  const input = req.valid.body;
  const makeDefault = input.isDefault || count === 0;
  if (makeDefault) await Address.updateMany({ user: req.user._id }, { $set: { isDefault: false } });
  const doc = await Address.create({ ...input, phone: input.phone || undefined, user: req.user._id, isDefault: makeDefault });
  created(res, serializeAddress(doc));
});

router.put('/addresses/:id', validate({ params: z.object({ id: objectId }), body: addressBody.partial() }), async (req, res) => {
  const input = req.valid.body;
  if (input.isDefault) await Address.updateMany({ user: req.user._id, _id: { $ne: req.valid.params.id } }, { $set: { isDefault: false } });
  const doc = await Address.findOneAndUpdate({ _id: req.valid.params.id, user: req.user._id }, { $set: { ...input, phone: input.phone || undefined } }, { new: true });
  if (!doc) throw notFound('Address not found.');
  ok(res, serializeAddress(doc));
});

router.delete('/addresses/:id', validate({ params: z.object({ id: objectId }) }), async (req, res) => {
  const doc = await Address.findOneAndDelete({ _id: req.valid.params.id, user: req.user._id });
  if (!doc) throw notFound('Address not found.');
  if (doc.isDefault) {
    const next = await Address.findOne({ user: req.user._id }).sort({ createdAt: 1 });
    if (next) await Address.updateOne({ _id: next._id }, { $set: { isDefault: true } });
  }
  ok(res, { deleted: true });
});

// Favourites -------------------------------------------------------------------------------------------

router.get('/favorites', async (req, res) => {
  const user = await User.findById(req.user._id).select('favorites').lean();
  const ids = (user?.favorites ?? []).map(String);
  const rows = ids.length
    ? await MenuItem.find({ _id: { $in: ids }, archived: false })
        .populate([{ path: 'optionGroups', select: 'key isRequired minSelect active' }, { path: 'category', select: 'name slug' }])
        .lean()
    : [];
  ok(res, { ids, items: rows.map((r) => serializeMenuItem(r)) });
});

router.put('/favorites/:itemId', validate({ params: z.object({ itemId: objectId }) }), async (req, res) => {
  if (!(await MenuItem.exists({ _id: req.valid.params.itemId, archived: false }))) throw notFound('That dish is not on the menu.');
  await User.updateOne({ _id: req.user._id }, { $addToSet: { favorites: req.valid.params.itemId } });
  ok(res, { favorite: true });
});

router.delete('/favorites/:itemId', validate({ params: z.object({ itemId: objectId }) }), async (req, res) => {
  await User.updateOne({ _id: req.user._id }, { $pull: { favorites: req.valid.params.itemId } });
  ok(res, { favorite: false });
});

// Orders -----------------------------------------------------------------------------------------------

router.get('/orders', validate({ query: z.object({ scope: z.enum(['all', 'active', 'past']).default('all'), page: z.coerce.number().int().min(1).default(1), pageSize: z.coerce.number().int().min(1).max(50).default(10) }) }), async (req, res) => {
  const { scope } = req.valid.query;
  const filter = { user: req.user._id };
  if (scope === 'active') filter.status = { $in: ['pending_payment', 'placed', 'confirmed', 'preparing', 'ready', 'out_for_delivery'] };
  if (scope === 'past') filter.status = { $in: ['delivered', 'cancelled', 'rejected'] };
  const { skip, limit, page, pageSize } = parsePagination(req.valid.query, { defaultSize: 10, maxSize: 50 });
  const [rows, total] = await Promise.all([Order.find(filter).sort({ createdAt: -1 }).skip(skip).limit(limit).lean(), Order.countDocuments(filter)]);
  ok(res, rows.map((o) => serializeOrder(o, 'owner')), pageMeta({ page, pageSize }, total));
});

router.get('/orders/:id', async (req, res) => {
  const order = await Order.findOne({ ...byIdOrPublicId(req.params.id), user: req.user._id }).lean();
  if (!order) throw notFound('Order not found.');
  ok(res, serializeOrder(order, 'owner'));
});

// "Order again": the current menu entries for a past order's dishes, so the cart can be rebuilt with today's prices.
router.get('/orders/:id/reorder', async (req, res) => {
  const order = await Order.findOne({ ...byIdOrPublicId(req.params.id), user: req.user._id }).lean();
  if (!order) throw notFound('Order not found.');
  const ids = order.items.map((i) => i.menuItem).filter(Boolean);
  const rows = await MenuItem.find({ _id: { $in: ids }, archived: false, available: true }).select('_id').lean();
  const live = new Set(rows.map((r) => String(r._id)));
  ok(res, {
    lines: order.items.filter((i) => i.menuItem && live.has(String(i.menuItem))).map((i) => ({ menuItemId: String(i.menuItem), quantity: i.quantity, selections: groupSelections(i.options), note: i.note })),
    skipped: order.items.filter((i) => !i.menuItem || !live.has(String(i.menuItem))).map((i) => i.name),
  });
});

function groupSelections(options = []) {
  const byGroup = new Map();
  for (const o of options) byGroup.set(o.group, [...(byGroup.get(o.group) ?? []), o.choice]);
  return [...byGroup.entries()].map(([group, choices]) => ({ group, choices }));
}

// Notifications ----------------------------------------------------------------------------------------

const visibleTo = (user) => ({ $or: [{ user: user._id }, ...(user.role !== 'customer' ? [{ audience: 'staff', roles: user.role }] : [])] });
const asDto = (n, userId) => ({ ...serializeNotification(n), read: n.audience === 'staff' ? (n.readBy ?? []).some((id) => String(id) === String(userId)) : Boolean(n.readAt) });
const unreadFilter = (user) => ({
  $or: [{ user: user._id, readAt: null }, ...(user.role !== 'customer' ? [{ audience: 'staff', roles: user.role, readBy: { $ne: user._id } }] : [])],
});

router.get('/notifications', validate({ query: z.object({ page: z.coerce.number().int().min(1).default(1), pageSize: z.coerce.number().int().min(1).max(50).default(20) }) }), async (req, res) => {
  const { skip, limit, page, pageSize } = parsePagination(req.valid.query, { defaultSize: 20, maxSize: 50 });
  const filter = visibleTo(req.user);
  const [rows, total, unread] = await Promise.all([
    Notification.find(filter).sort({ createdAt: -1 }).skip(skip).limit(limit).lean(),
    Notification.countDocuments(filter),
    Notification.countDocuments(unreadFilter(req.user)),
  ]);
  ok(res, rows.map((n) => asDto(n, req.user._id)), { ...pageMeta({ page, pageSize }, total), unread });
});

router.get('/notifications/unread-count', async (req, res) => ok(res, { count: await Notification.countDocuments(unreadFilter(req.user)) }));

router.post('/notifications/read', validate({ body: z.object({ ids: z.array(objectId).max(100).optional() }) }), async (req, res) => {
  const { ids } = req.valid.body;
  const idFilter = ids?.length ? { _id: { $in: ids } } : {};
  await Notification.updateMany({ user: req.user._id, readAt: null, ...idFilter }, { $set: { readAt: new Date() } });
  if (req.user.role !== 'customer') await Notification.updateMany({ audience: 'staff', roles: req.user.role, ...idFilter }, { $addToSet: { readBy: req.user._id } });
  ok(res, { read: true });
});

// Account deletion: personal data is removed, order records stay (anonymised) for the restaurant's accounts. ----------------

router.post('/delete', limiter({ windowMs: 15 * 60_000, limit: 5 }), validate({ body: z.object({ password: z.string().min(1).max(128) }) }), async (req, res) => {
  const user = await User.findById(req.user._id).select('+passwordHash');
  if (req.user.role !== 'customer') throw conflict('Staff accounts are removed by the owner from the staff page.', 'STAFF_ACCOUNT');
  if (!user?.passwordHash || !(await verifyPassword(req.valid.body.password, user.passwordHash))) throw unauthorized('That password is not right.');
  await Promise.all([Address.deleteMany({ user: user._id }), Cart.deleteMany({ user: user._id }), Notification.deleteMany({ user: user._id }), Session.deleteMany({ user: user._id })]);
  await User.updateOne(
    { _id: user._id },
    {
      $set: { status: 'deleted', name: 'Deleted account', email: `deleted-${user._id}@elan.invalid`, favorites: [], recentlyViewed: [], marketingOptIn: false },
      $unset: { phone: '', avatarUrl: '', birthday: '', passwordHash: '', referralCode: '' },
    },
  );
  await Order.updateMany({ user: user._id }, { $set: { 'customer.name': 'Deleted account' }, $unset: { 'customer.email': '' } });
  await audit({ id: user._id, name: 'Account owner', role: 'customer', ip: req.ip }, 'account.delete', { type: 'user', id: user._id }, 'Customer deleted their account');
  res.clearCookie('elan_session');
  ok(res, { deleted: true });
});

export default router;
