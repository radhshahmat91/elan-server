// Loads the restaurant's real content: settings, menu, option groups, tables, FAQ, gallery, offers and the stock room.
//
// Safe to run on a live database. Nothing that already exists is touched: rows are matched by their natural key
// (slug, number, code, sku, name) and only the missing ones are inserted, so edits made in the admin survive a re-run.
import {
  AddOn, Category, Coupon, Faq, GalleryItem, Ingredient, MenuItem, Restaurant, StockTransaction, Supplier, Table,
} from '../models/index.js';
import { randomToken } from '../utils/crypto.js';
import { invalidateRestaurantCache } from '../services/restaurantService.js';
import { restaurantData } from './data/restaurant.js';
import { ADD_ONS, CATEGORIES, DISHES, INGREDIENTS, SUPPLIERS } from './data/menu.js';
import { FAQS, GALLERY, TABLES, couponData } from './data/content.js';

const DAY = 86_400_000;
const DUPLICATE_KEY = 11000;

const isDuplicateOnly = (err) =>
  err?.code === DUPLICATE_KEY || (Array.isArray(err?.writeErrors) && err.writeErrors.length > 0 && err.writeErrors.every((e) => e.code === DUPLICATE_KEY));

/**
 * Inserts the rows whose key is not in the collection yet. Returns the rows that were really inserted.
 * Two seeds running at once may collide on a unique index; that is fine, the other run already inserted the row.
 */
async function insertMissing(Model, rows, keyField) {
  if (rows.length === 0) return [];
  const present = await Model.find({ [keyField]: { $in: rows.map((r) => r[keyField]) } }).select(keyField).lean();
  const have = new Set(present.map((d) => String(d[keyField])));
  const fresh = rows.filter((r) => !have.has(String(r[keyField])));
  if (fresh.length === 0) return [];
  try {
    await Model.insertMany(fresh, { ordered: false });
  } catch (err) {
    if (!isDuplicateOnly(err)) throw err;
  }
  return fresh;
}

const byKey = (docs, field) => new Map(docs.map((d) => [String(d[field]), d]));

/** Every key a recipe, option group or category reference points at must exist; a typo should fail loudly, not silently. */
function need(map, key, what) {
  const doc = map.get(String(key));
  if (!doc) throw new Error(`Seed data refers to ${what} "${key}", which does not exist.`);
  return doc;
}

/**
 * @param {{ now?: Date, log?: (line: string) => void }} [options]
 * @returns the counts of what was created, and the loaded documents other seed steps need.
 */
export async function seedContent({ now = new Date(), log = () => {} } = {}) {
  const created = {};

  // --- settings -------------------------------------------------------------------------------------------------
  const settings = await Restaurant.updateOne({ key: 'main' }, { $setOnInsert: restaurantData() }, { upsert: true });
  created.settings = settings.upsertedCount ? 1 : 0;

  // --- categories -----------------------------------------------------------------------------------------------
  created.categories = (await insertMissing(Category, CATEGORIES.map((c) => ({ ...c, active: true })), 'slug')).length;
  const categories = byKey(await Category.find({ slug: { $in: CATEGORIES.map((c) => c.slug) } }).lean(), 'slug');

  // --- option groups --------------------------------------------------------------------------------------------
  created.addOns = (await insertMissing(AddOn, ADD_ONS.map((a) => ({ ...a, active: true })), 'key')).length;
  const addOns = byKey(await AddOn.find({ key: { $in: ADD_ONS.map((a) => a.key) } }).lean(), 'key');

  // --- suppliers and stock room ---------------------------------------------------------------------------------
  const supplierRows = SUPPLIERS.map((s) => ({ name: s.name, contactName: s.contactName, phone: s.phone, email: s.email, address: s.address, notes: s.notes, active: true }));
  created.suppliers = (await insertMissing(Supplier, supplierRows, 'name')).length;
  const suppliers = new Map();
  for (const doc of await Supplier.find({ name: { $in: SUPPLIERS.map((s) => s.name) } }).lean()) {
    const source = SUPPLIERS.find((s) => s.name === doc.name);
    if (source) suppliers.set(source.key, doc);
  }

  const ingredientRows = INGREDIENTS.map((i) => ({
    sku: `ELAN-${i.key.toUpperCase()}`,
    name: i.name,
    unit: i.unit,
    stock: i.stock,
    lowStockThreshold: i.low,
    costPerUnit: i.cost,
    supplier: need(suppliers, i.supplier, 'supplier')._id,
    nearestExpiry: i.expiresInDays ? new Date(now.getTime() + i.expiresInDays * DAY) : null,
    active: true,
  }));
  const freshIngredients = await insertMissing(Ingredient, ingredientRows, 'sku');
  created.ingredients = freshIngredients.length;
  const ingredientDocs = await Ingredient.find({ sku: { $in: ingredientRows.map((r) => r.sku) } }).lean();
  const ingredients = new Map(INGREDIENTS.map((i) => [i.key, ingredientDocs.find((d) => d.sku === `ELAN-${i.key.toUpperCase()}`)]).filter(([, d]) => d));

  // An opening-balance line in the stock history for each new ingredient, so the ledger explains today's quantity.
  if (freshIngredients.length) {
    const freshSkus = new Set(freshIngredients.map((r) => r.sku));
    const openings = ingredientDocs
      .filter((d) => freshSkus.has(d.sku))
      .map((d) => ({
        ingredient: d._id,
        type: 'in',
        quantity: d.stock,
        balanceAfter: d.stock,
        reason: 'Opening stock',
        supplier: d.supplier,
        unitCost: d.costPerUnit,
        by: { name: 'Setup' },
      }));
    if (openings.length) await StockTransaction.insertMany(openings);
  }

  // --- menu -----------------------------------------------------------------------------------------------------
  const dishRows = DISHES.map((d, index) => ({
    name: d.name,
    slug: d.slug,
    category: need(categories, d.category, 'category')._id,
    description: d.description,
    price: d.price,
    salePrice: d.salePrice ?? null,
    images: [],
    art: { motif: d.motif, seed: d.seed },
    optionGroups: d.groups.map((key) => need(addOns, key, 'option group')._id),
    tags: d.tags,
    allergens: d.allergens,
    spiceLevel: d.spice,
    portion: d.portion,
    calories: d.calories,
    ingredients: d.ingredients,
    prepMinutes: d.prep,
    available: true,
    featured: Boolean(d.featured),
    newArrival: Boolean(d.newArrival),
    sortOrder: index + 1,
    recipe: d.recipe.map((line) => ({ ingredient: need(ingredients, line.ingredient, 'ingredient')._id, quantity: line.quantity })),
  }));
  created.dishes = (await insertMissing(MenuItem, dishRows, 'slug')).length;

  // The chef's special on the home page defaults to the hilsa, unless an owner already picked something.
  const hilsa = await MenuItem.findOne({ slug: 'ilish-bhapa' }).select('_id').lean();
  if (hilsa) {
    await Restaurant.updateOne({ key: 'main', $or: [{ chefsSpecial: { $exists: false } }, { chefsSpecial: null }] }, { $set: { chefsSpecial: hilsa._id } });
  }

  // --- tables ---------------------------------------------------------------------------------------------------
  const tableRows = TABLES.map((t) => ({ ...t, active: true, qrToken: randomToken(12) }));
  created.tables = (await insertMissing(Table, tableRows, 'number')).length;
  const tables = byKey(await Table.find({ number: { $in: TABLES.map((t) => t.number) } }).lean(), 'number');

  // --- FAQ, gallery, offers -------------------------------------------------------------------------------------
  created.faqs = (await insertMissing(Faq, FAQS.map((f) => ({ ...f, active: true })), 'question')).length;
  created.gallery = (await insertMissing(GalleryItem, GALLERY.map((g, i) => ({ ...g, sortOrder: i + 1, active: true })), 'title')).length;
  const couponRows = couponData(now);
  created.coupons = (await insertMissing(Coupon, couponRows, 'code')).length;
  const coupons = byKey(await Coupon.find({ code: { $in: couponRows.map((c) => c.code) } }).lean(), 'code');

  invalidateRestaurantCache();
  const total = Object.values(created).reduce((sum, n) => sum + n, 0);
  log(total === 0 ? 'Content already in place; nothing to add.' : `Content added: ${Object.entries(created).filter(([, n]) => n > 0).map(([k, n]) => `${n} ${k}`).join(', ')}.`);

  return { created, categories, addOns, suppliers, ingredients, tables, coupons };
}

/** The sellable menu with option groups and category populated, the shape priceLine() expects. */
export async function loadMenu() {
  return MenuItem.find({ archived: false }).populate('optionGroups').populate('category', 'name').sort({ sortOrder: 1 }).lean();
}
