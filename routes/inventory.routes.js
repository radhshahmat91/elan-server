// Stock control: ingredients, suppliers, movements and the recipes that tie dishes to ingredients.
import { Router } from 'express';
import { Ingredient, MenuItem, StockTransaction, Supplier } from '../models/index.js';
import { INGREDIENT_UNITS } from '../models/constants.js';
import { requirePermission } from '../middleware/auth.js';
import { limiter } from '../middleware/rateLimit.js';
import { dateKey, objectId, validate, z } from '../middleware/validate.js';
import { fromLocal } from '../utils/dates.js';
import { conflict, notFound, unprocessable } from '../utils/errors.js';
import { containsRegex, created, ok, pageMeta, parsePagination } from '../utils/http.js';
import { serializeIngredient, serializeStockTransaction, serializeSupplier, signedQuantity } from '../serializers/inventory.js';
import { audit } from '../services/auditService.js';
import { adjustStock, lowStockList } from '../services/inventoryService.js';

export const basePath = '/admin/inventory';
const router = Router();

const opt = (schema) => z.union([schema, z.literal('').transform(() => undefined)]).optional();
const actorOf = (req) => ({ id: req.user._id, name: req.user.name });
const qty = z.number().min(0).max(1_000_000);

// Ingredients ----------------------------------------------------------------------------------------

const ingredientShape = z.object({
  name: z.string().trim().min(2, 'Enter a name').max(100),
  sku: opt(z.string().trim().max(40)),
  unit: z.enum(INGREDIENT_UNITS),
  lowStockThreshold: qty,
  costPerUnit: z.number().int().min(0).max(1_000_000),
  supplierId: objectId.nullable(),
  nearestExpiry: dateKey.nullable(),
  active: z.boolean(),
});

const listQuery = z.object({
  q: z.string().trim().max(80).optional(),
  filter: z.enum(['all', 'low', 'expiring', 'inactive']).default('all'),
  supplier: objectId.optional(),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(200).default(50),
});

router.get('/ingredients', requirePermission('inventory:read'), validate({ query: listQuery }), async (req, res) => {
  const q = req.valid.query;
  const filter = { active: q.filter !== 'inactive' };
  if (q.supplier) filter.supplier = q.supplier;
  if (q.q) filter.name = containsRegex(q.q);
  const rows = await Ingredient.find(filter).populate('supplier', 'name').sort({ name: 1 }).limit(2000).lean();
  const now = new Date();
  const all = rows.map((r) => serializeIngredient(r, now));
  const counts = {
    total: all.length,
    low: all.filter((i) => i.status === 'low').length,
    out: all.filter((i) => i.status === 'out').length,
    expiring: all.filter((i) => i.expiry === 'soon' || i.expiry === 'expired').length,
  };
  const value = all.reduce((sum, i) => sum + i.value, 0);
  let list = all;
  if (q.filter === 'low') list = all.filter((i) => i.status !== 'ok');
  if (q.filter === 'expiring') list = all.filter((i) => i.expiry === 'soon' || i.expiry === 'expired');
  const { skip, limit, page, pageSize } = parsePagination(req.valid.query, { defaultSize: 50, maxSize: 200 });
  ok(res, list.slice(skip, skip + limit), { ...pageMeta({ page, pageSize }, list.length), counts, value });
});

router.get('/low-stock', requirePermission('inventory:read'), async (_req, res) => {
  const rows = await lowStockList();
  const now = new Date();
  ok(res, rows.map((r) => serializeIngredient(r, now)));
});

router.post(
  '/ingredients',
  requirePermission('inventory:create'),
  validate({ body: ingredientShape.partial({ sku: true, lowStockThreshold: true, costPerUnit: true, supplierId: true, nearestExpiry: true, active: true }).extend({ stock: qty.optional() }) }),
  async (req, res) => {
    const { stock = 0, supplierId, nearestExpiry, ...rest } = req.valid.body;
    if (supplierId && !(await Supplier.exists({ _id: supplierId }))) throw unprocessable('Choose a supplier from the list.');
    let doc;
    try {
      doc = await Ingredient.create({ ...rest, stock, supplier: supplierId || null, nearestExpiry: nearestExpiry ? fromLocal(nearestExpiry) : null });
    } catch (err) {
      if (err?.code === 11000) throw conflict('That SKU is already used by another ingredient.', 'SKU_TAKEN');
      throw err;
    }
    if (stock > 0) await StockTransaction.create({ ingredient: doc._id, type: 'in', quantity: stock, balanceAfter: stock, reason: 'Opening balance', by: actorOf(req) });
    await audit(req, 'inventory.create', { type: 'ingredient', id: doc._id }, `Added ingredient ${doc.name}`);
    created(res, serializeIngredient(doc));
  },
);

router.put('/ingredients/:id', requirePermission('inventory:update'), validate({ params: z.object({ id: objectId }), body: ingredientShape.partial() }), async (req, res) => {
  const { supplierId, nearestExpiry, ...rest } = req.valid.body;
  const set = { ...rest };
  if (supplierId !== undefined) {
    if (supplierId && !(await Supplier.exists({ _id: supplierId }))) throw unprocessable('Choose a supplier from the list.');
    set.supplier = supplierId || null;
  }
  if (nearestExpiry !== undefined) set.nearestExpiry = nearestExpiry ? fromLocal(nearestExpiry) : null;
  let doc;
  try {
    doc = await Ingredient.findByIdAndUpdate(req.valid.params.id, { $set: set }, { new: true }).populate('supplier', 'name').lean();
  } catch (err) {
    if (err?.code === 11000) throw conflict('That SKU is already used by another ingredient.', 'SKU_TAKEN');
    throw err;
  }
  if (!doc) throw notFound('Ingredient not found.');
  await audit(req, 'inventory.update', { type: 'ingredient', id: doc._id }, `Updated ingredient ${doc.name}`, { fields: Object.keys(set) });
  ok(res, serializeIngredient(doc));
});

// An ingredient that was ever used keeps its history, so it is archived instead of deleted.
router.delete('/ingredients/:id', requirePermission('inventory:delete'), validate({ params: z.object({ id: objectId }) }), async (req, res) => {
  const id = req.valid.params.id;
  const doc = await Ingredient.findById(id);
  if (!doc) throw notFound('Ingredient not found.');
  const [usedInRecipe, hasHistory] = await Promise.all([MenuItem.exists({ 'recipe.ingredient': id }), StockTransaction.exists({ ingredient: id })]);
  if (usedInRecipe || hasHistory) {
    await Ingredient.updateOne({ _id: id }, { $set: { active: false } });
    await audit(req, 'inventory.archive', { type: 'ingredient', id }, `Archived ingredient ${doc.name}`);
    return ok(res, { archived: true });
  }
  await Ingredient.deleteOne({ _id: id });
  await audit(req, 'inventory.delete', { type: 'ingredient', id }, `Deleted ingredient ${doc.name}`);
  return ok(res, { deleted: true });
});

const adjustBody = z.object({
  type: z.enum(['in', 'out', 'waste', 'adjust']),
  quantity: z.number().min(-1_000_000).max(1_000_000),
  reason: z.string().trim().max(200).optional(),
  supplierId: objectId.nullable().optional(),
  unitCost: z.number().int().min(0).max(1_000_000).optional(),
  nearestExpiry: dateKey.nullable().optional(),
});

router.post(
  '/ingredients/:id/adjust',
  requirePermission('inventory:adjust'),
  limiter({ windowMs: 5 * 60_000, limit: 120 }),
  validate({ params: z.object({ id: objectId }), body: adjustBody }),
  async (req, res) => {
    const { type, quantity, reason, supplierId, unitCost, nearestExpiry } = req.valid.body;
    const delta = signedQuantity(type, quantity);
    if (delta === 0) throw unprocessable('Enter a quantity other than zero.');
    if (type === 'adjust' && !reason) throw unprocessable('Say why the count changed, so the history makes sense later.');
    const after = await adjustStock({ ingredientId: req.valid.params.id, quantity: delta, type, reason, supplierId, unitCost, actor: actorOf(req) });
    const set = {};
    if (type === 'in' && unitCost != null) set.costPerUnit = unitCost; // the latest price paid becomes the working cost
    if (type === 'in' && nearestExpiry !== undefined) set.nearestExpiry = nearestExpiry ? fromLocal(nearestExpiry) : null;
    if (Object.keys(set).length) await Ingredient.updateOne({ _id: after._id }, { $set: set });
    await audit(req, 'inventory.adjust', { type: 'ingredient', id: after._id }, `${after.name}: ${delta > 0 ? '+' : ''}${delta} ${after.unit} (${type})`, { reason });
    const fresh = await Ingredient.findById(after._id).populate('supplier', 'name').lean();
    ok(res, serializeIngredient(fresh));
  },
);

router.get('/ingredients/:id/history', requirePermission('inventory:read'), validate({ params: z.object({ id: objectId }), query: z.object({ page: z.coerce.number().int().min(1).default(1), pageSize: z.coerce.number().int().min(1).max(100).default(30) }) }), async (req, res) => {
  const filter = { ingredient: req.valid.params.id };
  const { skip, limit, page, pageSize } = parsePagination(req.valid.query, { defaultSize: 30, maxSize: 100 });
  const [rows, total] = await Promise.all([StockTransaction.find(filter).sort({ createdAt: -1 }).skip(skip).limit(limit).lean(), StockTransaction.countDocuments(filter)]);
  ok(res, rows.map(serializeStockTransaction), pageMeta({ page, pageSize }, total));
});

router.get('/movements', requirePermission('inventory:read'), validate({ query: z.object({ type: z.enum(['in', 'out', 'adjust', 'waste', 'order']).optional(), page: z.coerce.number().int().min(1).default(1), pageSize: z.coerce.number().int().min(1).max(100).default(30) }) }), async (req, res) => {
  const filter = req.valid.query.type ? { type: req.valid.query.type } : {};
  const { skip, limit, page, pageSize } = parsePagination(req.valid.query, { defaultSize: 30, maxSize: 100 });
  const [rows, total] = await Promise.all([
    StockTransaction.find(filter).sort({ createdAt: -1 }).skip(skip).limit(limit).populate('ingredient', 'name unit').lean(),
    StockTransaction.countDocuments(filter),
  ]);
  ok(res, rows.map(serializeStockTransaction), pageMeta({ page, pageSize }, total));
});

// Suppliers ------------------------------------------------------------------------------------------

const supplierShape = z.object({
  name: z.string().trim().min(2, 'Enter a name').max(100),
  contactName: opt(z.string().trim().max(80)),
  phone: opt(z.string().trim().max(24)),
  email: opt(z.string().trim().toLowerCase().email('Enter a valid email address').max(160)),
  address: opt(z.string().trim().max(200)),
  notes: opt(z.string().trim().max(300)),
  active: z.boolean(),
});

router.get('/suppliers', requirePermission('inventory:read'), async (_req, res) => {
  const [rows, counts] = await Promise.all([Supplier.find({}).sort({ active: -1, name: 1 }).lean(), Ingredient.aggregate([{ $match: { active: true, supplier: { $ne: null } } }, { $group: { _id: '$supplier', n: { $sum: 1 } } }])]);
  const countOf = new Map(counts.map((c) => [String(c._id), c.n]));
  ok(res, rows.map((s) => ({ ...serializeSupplier(s), ingredientCount: countOf.get(String(s._id)) ?? 0 })));
});

router.post('/suppliers', requirePermission('inventory:create'), validate({ body: supplierShape.partial({ contactName: true, phone: true, email: true, address: true, notes: true, active: true }) }), async (req, res) => {
  const doc = await Supplier.create(req.valid.body);
  await audit(req, 'supplier.create', { type: 'supplier', id: doc._id }, `Added supplier ${doc.name}`);
  created(res, serializeSupplier(doc));
});

router.put('/suppliers/:id', requirePermission('inventory:update'), validate({ params: z.object({ id: objectId }), body: supplierShape.partial() }), async (req, res) => {
  const doc = await Supplier.findByIdAndUpdate(req.valid.params.id, { $set: req.valid.body }, { new: true }).lean();
  if (!doc) throw notFound('Supplier not found.');
  await audit(req, 'supplier.update', { type: 'supplier', id: doc._id }, `Updated supplier ${doc.name}`, { fields: Object.keys(req.valid.body) });
  ok(res, serializeSupplier(doc));
});

router.delete('/suppliers/:id', requirePermission('inventory:delete'), validate({ params: z.object({ id: objectId }) }), async (req, res) => {
  const id = req.valid.params.id;
  const doc = await Supplier.findById(id);
  if (!doc) throw notFound('Supplier not found.');
  if (await Ingredient.exists({ supplier: id })) {
    await Supplier.updateOne({ _id: id }, { $set: { active: false } });
    await audit(req, 'supplier.archive', { type: 'supplier', id }, `Archived supplier ${doc.name}`);
    return ok(res, { archived: true });
  }
  await Supplier.deleteOne({ _id: id });
  await audit(req, 'supplier.delete', { type: 'supplier', id }, `Deleted supplier ${doc.name}`);
  return ok(res, { deleted: true });
});

// Recipes --------------------------------------------------------------------------------------------

router.get('/recipes/:menuItemId', requirePermission('inventory:read'), validate({ params: z.object({ menuItemId: objectId }) }), async (req, res) => {
  const item = await MenuItem.findById(req.valid.params.menuItemId).select('name recipe').lean();
  if (!item) throw notFound('Dish not found.');
  const ids = (item.recipe ?? []).map((r) => r.ingredient);
  const ingredients = ids.length ? await Ingredient.find({ _id: { $in: ids } }).select('name unit').lean() : [];
  const byId = new Map(ingredients.map((i) => [String(i._id), i]));
  ok(res, {
    menuItem: { id: String(item._id), name: item.name },
    recipe: (item.recipe ?? []).map((r) => ({ ingredientId: String(r.ingredient), name: byId.get(String(r.ingredient))?.name ?? 'Removed ingredient', unit: byId.get(String(r.ingredient))?.unit, quantity: r.quantity })),
  });
});

router.put(
  '/recipes/:menuItemId',
  requirePermission('inventory:update'),
  validate({
    params: z.object({ menuItemId: objectId }),
    body: z.object({ recipe: z.array(z.object({ ingredientId: objectId, quantity: z.number().gt(0).max(100_000) })).max(30) }),
  }),
  async (req, res) => {
    const { recipe } = req.valid.body;
    const unique = new Map();
    for (const line of recipe) unique.set(line.ingredientId, (unique.get(line.ingredientId) ?? 0) + line.quantity);
    const ids = [...unique.keys()];
    const found = ids.length ? await Ingredient.countDocuments({ _id: { $in: ids }, active: true }) : 0;
    if (found !== ids.length) throw unprocessable('One of those ingredients no longer exists. Refresh and try again.');
    const item = await MenuItem.findByIdAndUpdate(req.valid.params.menuItemId, { $set: { recipe: [...unique].map(([ingredient, quantity]) => ({ ingredient, quantity })) } }, { new: true }).select('name').lean();
    if (!item) throw notFound('Dish not found.');
    await audit(req, 'inventory.recipe', { type: 'menuItem', id: item._id }, `Updated the recipe for ${item.name}`, { lines: ids.length });
    ok(res, { saved: true, lines: ids.length });
  },
);

export default router;
