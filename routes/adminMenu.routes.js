import { Router } from 'express';
import { AddOn, Category, MenuItem } from '../models/index.js';
import { ALLERGENS, ART_MOTIFS, DIETARY_TAGS } from '../models/constants.js';
import { requirePermission } from '../middleware/auth.js';
import { objectId, validate, z } from '../middleware/validate.js';
import { conflict, notFound } from '../utils/errors.js';
import { containsRegex, created, ok, pageMeta, parsePagination } from '../utils/http.js';
import { slugify } from '../utils/ids.js';
import { audit } from '../services/auditService.js';
import { serializeCategory, serializeMenuItemAdmin, serializeOptionGroup } from '../serializers/menu.js';

export const basePath = '/admin/menu';
const router = Router();

const text = (max) => z.string().trim().max(max);
const optText = (max) => z.union([text(max), z.literal('')]).optional();
const image = z.object({ url: z.string().trim().max(500).refine((u) => /^https?:\/\//.test(u) || u.startsWith('/uploads/'), 'Use an https link or an uploaded image'), alt: optText(200), publicId: optText(120) });
const hex = z.string().regex(/^#[0-9a-f]{6}$/i, 'Use a #rrggbb colour');

const itemShape = z.object({
  name: z.string().trim().min(2).max(90),
  slug: z.string().trim().toLowerCase().regex(/^[a-z0-9-]+$/, 'Use lowercase letters, numbers and hyphens').max(80).optional(),
  category: objectId,
  description: z.string().trim().min(10).max(500),
  price: z.number().int().min(0).max(100000),
  salePrice: z.number().int().min(0).max(100000).nullable().optional(),
  images: z.array(image).max(6),
  art: z.object({ motif: z.enum(ART_MOTIFS).optional(), palette: z.array(hex).max(6).optional(), seed: z.number().int().min(0).max(100000).optional() }).optional(),
  optionGroups: z.array(objectId).max(12),
  tags: z.array(z.enum(DIETARY_TAGS)).max(9),
  allergens: z.array(z.enum(ALLERGENS)).max(10),
  spiceLevel: z.number().int().min(0).max(3),
  portion: optText(60),
  calories: z.number().int().min(0).max(5000).nullable().optional(),
  ingredients: z.array(text(60)).max(30),
  prepMinutes: z.number().int().min(1).max(180),
  available: z.boolean(),
  featured: z.boolean(),
  newArrival: z.boolean(),
  sortOrder: z.number().int().min(-1000).max(1000),
  sku: optText(40),
  recipe: z.array(z.object({ ingredient: objectId, quantity: z.number().min(0).max(100000) })).max(30),
});
const saleOk = (v) => v.salePrice == null || v.price == null || v.salePrice <= v.price;
const SALE_MESSAGE = { message: 'The sale price cannot be higher than the regular price', path: ['salePrice'] };
const createItem = itemShape
  .partial({ salePrice: true, images: true, art: true, optionGroups: true, tags: true, allergens: true, spiceLevel: true, portion: true, calories: true, ingredients: true, prepMinutes: true, available: true, featured: true, newArrival: true, sortOrder: true, sku: true, recipe: true, slug: true })
  .refine(saleOk, SALE_MESSAGE);
const updateItem = itemShape.partial().refine(saleOk, SALE_MESSAGE);

const ITEM_POPULATE = [{ path: 'optionGroups' }, { path: 'category', select: 'name slug' }, { path: 'recipe.ingredient', select: 'name' }];

async function uniqueSlug(base, ignoreId) {
  const root = slugify(base) || 'dish';
  for (let i = 0; i < 40; i += 1) {
    const candidate = i === 0 ? root : `${root}-${i + 1}`;
    const clash = await MenuItem.exists({ slug: candidate, ...(ignoreId ? { _id: { $ne: ignoreId } } : {}) });
    if (!clash) return candidate;
  }
  return `${root}-${Date.now().toString(36)}`;
}

const cleanItem = (input) => {
  const out = { ...input };
  for (const key of ['portion', 'sku']) if (out[key] === '') out[key] = undefined;
  if (out.images) out.images = out.images.map((i) => ({ ...i, alt: i.alt || undefined, publicId: i.publicId || undefined }));
  return out;
};

// Items ----------------------------------------------------------------------------------------------

const listQuery = z.object({
  q: z.string().trim().max(80).optional(),
  category: objectId.optional(),
  status: z.enum(['all', 'available', 'unavailable', 'archived']).default('all'),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(30),
});

router.get('/items', requirePermission('menu:read'), validate({ query: listQuery }), async (req, res) => {
  const q = req.valid.query;
  const filter = {};
  if (q.q) {
    const re = containsRegex(q.q);
    filter.$or = [{ name: re }, { sku: re }];
  }
  if (q.category) filter.category = q.category;
  if (q.status === 'archived') filter.archived = true;
  else filter.archived = false;
  if (q.status === 'available') filter.available = true;
  if (q.status === 'unavailable') filter.available = false;
  const { skip, limit, page, pageSize } = parsePagination(req.valid.query, { defaultSize: 30, maxSize: 100 });
  const [rows, total] = await Promise.all([
    MenuItem.find(filter).sort({ archived: 1, sortOrder: 1, name: 1 }).skip(skip).limit(limit).populate(ITEM_POPULATE).lean(),
    MenuItem.countDocuments(filter),
  ]);
  ok(res, rows.map(serializeMenuItemAdmin), pageMeta({ page, pageSize }, total));
});

// The kitchen may switch dishes on and off during service without seeing prices or recipes.
router.get('/availability', requirePermission('menu:availability'), async (_req, res) => {
  const rows = await MenuItem.find({ archived: false }).sort({ sortOrder: 1, name: 1 }).populate('category', 'name').select('name available category art').lean();
  ok(res, rows.map((r) => ({ id: String(r._id), name: r.name, available: r.available, category: r.category?.name, art: r.art?.motif ? { motif: r.art.motif, palette: r.art.palette } : undefined })));
});

router.patch('/items/:id/availability', requirePermission('menu:availability'), validate({ params: z.object({ id: objectId }), body: z.object({ available: z.boolean() }) }), async (req, res) => {
  const item = await MenuItem.findByIdAndUpdate(req.valid.params.id, { $set: { available: req.valid.body.available } }, { new: true }).select('name available');
  if (!item) throw notFound('Dish not found.');
  await audit(req, 'menu.availability', { type: 'menuItem', id: item._id }, `${item.name} marked ${item.available ? 'available' : 'unavailable'}`);
  ok(res, { id: String(item._id), available: item.available });
});

router.get('/items/:id', requirePermission('menu:read'), validate({ params: z.object({ id: objectId }) }), async (req, res) => {
  const item = await MenuItem.findById(req.valid.params.id).populate(ITEM_POPULATE).lean();
  if (!item) throw notFound('Dish not found.');
  ok(res, serializeMenuItemAdmin(item));
});

router.post('/items', requirePermission('menu:create'), validate({ body: createItem }), async (req, res) => {
  const input = cleanItem(req.valid.body);
  if (!(await Category.exists({ _id: input.category }))) throw notFound('That category does not exist.');
  const slug = await uniqueSlug(input.slug || input.name);
  const doc = await MenuItem.create({ ...input, slug });
  await audit(req, 'menu.create', { type: 'menuItem', id: doc._id }, `Created dish ${doc.name}`);
  const full = await MenuItem.findById(doc._id).populate(ITEM_POPULATE).lean();
  created(res, serializeMenuItemAdmin(full));
});

router.put('/items/:id', requirePermission('menu:update'), validate({ params: z.object({ id: objectId }), body: updateItem }), async (req, res) => {
  const input = cleanItem(req.valid.body);
  const existing = await MenuItem.findById(req.valid.params.id).select('name price salePrice');
  if (!existing) throw notFound('Dish not found.');
  if (input.category && !(await Category.exists({ _id: input.category }))) throw notFound('That category does not exist.');
  if (input.slug) input.slug = await uniqueSlug(input.slug, existing._id);
  // salePrice is validated against the price the dish will have after this update.
  const price = input.price ?? existing.price;
  if (input.salePrice != null && input.salePrice > price) throw conflict('The sale price cannot be higher than the regular price.', 'BAD_SALE_PRICE');
  const set = {};
  const unset = {};
  for (const [key, value] of Object.entries(input)) (value === undefined ? unset : set)[key] = value === undefined ? '' : value;
  const update = { ...(Object.keys(set).length ? { $set: set } : {}), ...(Object.keys(unset).length ? { $unset: unset } : {}) };
  if (Object.keys(update).length) await MenuItem.updateOne({ _id: existing._id }, update);
  await audit(req, 'menu.update', { type: 'menuItem', id: existing._id }, `Updated dish ${existing.name}`, { fields: Object.keys(input), before: { price: existing.price, salePrice: existing.salePrice }, after: { price: input.price, salePrice: input.salePrice } });
  const full = await MenuItem.findById(existing._id).populate(ITEM_POPULATE).lean();
  ok(res, serializeMenuItemAdmin(full));
});

// Dishes with order history are archived, never deleted, so past orders keep their link.
router.delete('/items/:id', requirePermission('menu:delete'), validate({ params: z.object({ id: objectId }) }), async (req, res) => {
  const item = await MenuItem.findByIdAndUpdate(req.valid.params.id, { $set: { archived: true, available: false, featured: false } }, { new: true }).select('name');
  if (!item) throw notFound('Dish not found.');
  await audit(req, 'menu.archive', { type: 'menuItem', id: item._id }, `Archived dish ${item.name}`);
  ok(res, { id: String(item._id), archived: true });
});

router.post('/items/:id/restore', requirePermission('menu:update'), validate({ params: z.object({ id: objectId }) }), async (req, res) => {
  const item = await MenuItem.findByIdAndUpdate(req.valid.params.id, { $set: { archived: false } }, { new: true }).select('name');
  if (!item) throw notFound('Dish not found.');
  await audit(req, 'menu.restore', { type: 'menuItem', id: item._id }, `Restored dish ${item.name}`);
  ok(res, { id: String(item._id), archived: false });
});

// Categories -----------------------------------------------------------------------------------------

const categoryShape = z.object({
  name: z.string().trim().min(2).max(60),
  slug: z.string().trim().toLowerCase().regex(/^[a-z0-9-]+$/).max(60).optional(),
  description: optText(300),
  sortOrder: z.number().int().min(-1000).max(1000),
  active: z.boolean(),
  art: z.object({ motif: z.enum(ART_MOTIFS).optional(), palette: z.array(hex).max(6).optional() }).optional(),
});

router.get('/categories', requirePermission('menu:read'), async (_req, res) => {
  const [cats, counts] = await Promise.all([
    Category.find({}).sort({ sortOrder: 1, name: 1 }).lean(),
    MenuItem.aggregate([{ $match: { archived: false } }, { $group: { _id: '$category', n: { $sum: 1 } } }]),
  ]);
  const countOf = new Map(counts.map((c) => [String(c._id), c.n]));
  ok(res, cats.map((c) => ({ ...serializeCategory(c, countOf.get(String(c._id)) ?? 0), active: c.active })));
});

router.post('/categories', requirePermission('menu:create'), validate({ body: categoryShape.partial({ slug: true, description: true, sortOrder: true, active: true, art: true }) }), async (req, res) => {
  const input = req.valid.body;
  let slug = slugify(input.slug || input.name);
  if (await Category.exists({ slug })) slug = `${slug}-${Date.now().toString(36).slice(-4)}`;
  const doc = await Category.create({ ...input, slug, description: input.description || undefined });
  await audit(req, 'category.create', { type: 'category', id: doc._id }, `Created category ${doc.name}`);
  created(res, serializeCategory(doc.toObject(), 0));
});

router.put('/categories/:id', requirePermission('menu:update'), validate({ params: z.object({ id: objectId }), body: categoryShape.partial() }), async (req, res) => {
  const input = req.valid.body;
  if (input.slug) input.slug = slugify(input.slug);
  const doc = await Category.findByIdAndUpdate(req.valid.params.id, { $set: input }, { new: true }).lean();
  if (!doc) throw notFound('Category not found.');
  await audit(req, 'category.update', { type: 'category', id: doc._id }, `Updated category ${doc.name}`);
  ok(res, { ...serializeCategory(doc, await MenuItem.countDocuments({ category: doc._id, archived: false })), active: doc.active });
});

router.delete('/categories/:id', requirePermission('menu:delete'), validate({ params: z.object({ id: objectId }) }), async (req, res) => {
  if (await MenuItem.exists({ category: req.valid.params.id })) throw conflict('This category still has dishes. Move or archive them first, or hide the category instead.', 'CATEGORY_NOT_EMPTY');
  const doc = await Category.findByIdAndDelete(req.valid.params.id);
  if (!doc) throw notFound('Category not found.');
  await audit(req, 'category.delete', { type: 'category', id: doc._id }, `Deleted category ${doc.name}`);
  ok(res, { deleted: true });
});

// Option groups ("Cooking level", "Sauces") ------------------------------------------------------------

const choice = z.object({
  key: z.string().trim().toLowerCase().regex(/^[a-z0-9-]+$/, 'Use lowercase letters, numbers and hyphens').max(40),
  name: z.string().trim().min(1).max(80),
  priceDelta: z.number().int().min(-10000).max(10000),
  isDefault: z.boolean(),
  available: z.boolean(),
});
const groupShape = z.object({
  key: z.string().trim().toLowerCase().regex(/^[a-z0-9-]+$/, 'Use lowercase letters, numbers and hyphens').min(2).max(40),
  name: z.string().trim().min(2).max(80),
  helper: optText(160),
  isRequired: z.boolean(),
  minSelect: z.number().int().min(0).max(10),
  maxSelect: z.number().int().min(1).max(10),
  choices: z.array(choice).min(1).max(20),
  active: z.boolean(),
});
const groupOk = (g) => (g.minSelect == null || g.maxSelect == null || g.minSelect <= g.maxSelect) && (!g.choices || new Set(g.choices.map((c) => c.key)).size === g.choices.length);
const GROUP_MESSAGE = { message: 'Minimum cannot exceed maximum, and each choice needs its own key', path: ['choices'] };

router.get('/addons', requirePermission('menu:read'), async (_req, res) => {
  const [groups, usage] = await Promise.all([
    AddOn.find({}).sort({ name: 1 }).lean(),
    MenuItem.aggregate([{ $unwind: '$optionGroups' }, { $group: { _id: '$optionGroups', n: { $sum: 1 } } }]),
  ]);
  const used = new Map(usage.map((u) => [String(u._id), u.n]));
  ok(res, groups.map((g) => ({ ...serializeOptionGroup(g), active: g.active, usedBy: used.get(String(g._id)) ?? 0 })));
});

router.post('/addons', requirePermission('menu:create'), validate({ body: groupShape.partial({ helper: true, isRequired: true, minSelect: true, maxSelect: true, active: true }).refine(groupOk, GROUP_MESSAGE) }), async (req, res) => {
  const input = req.valid.body;
  if (await AddOn.exists({ key: input.key })) throw conflict('An option group with that key already exists.', 'KEY_TAKEN');
  const doc = await AddOn.create({ ...input, minSelect: input.minSelect ?? (input.isRequired ? 1 : 0), maxSelect: input.maxSelect ?? 1 });
  await audit(req, 'addon.create', { type: 'addon', id: doc._id }, `Created option group ${doc.name}`);
  created(res, serializeOptionGroup(doc.toObject()));
});

router.put('/addons/:id', requirePermission('menu:update'), validate({ params: z.object({ id: objectId }), body: groupShape.partial().refine(groupOk, GROUP_MESSAGE) }), async (req, res) => {
  const doc = await AddOn.findByIdAndUpdate(req.valid.params.id, { $set: req.valid.body }, { new: true }).lean();
  if (!doc) throw notFound('Option group not found.');
  await audit(req, 'addon.update', { type: 'addon', id: doc._id }, `Updated option group ${doc.name}`);
  ok(res, serializeOptionGroup(doc));
});

router.delete('/addons/:id', requirePermission('menu:delete'), validate({ params: z.object({ id: objectId }) }), async (req, res) => {
  if (await MenuItem.exists({ optionGroups: req.valid.params.id })) throw conflict('Dishes still use this option group. Remove it from them first, or mark it inactive.', 'ADDON_IN_USE');
  const doc = await AddOn.findByIdAndDelete(req.valid.params.id);
  if (!doc) throw notFound('Option group not found.');
  await audit(req, 'addon.delete', { type: 'addon', id: doc._id }, `Deleted option group ${doc.name}`);
  ok(res, { deleted: true });
});

export default router;
