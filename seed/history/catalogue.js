// An in-memory stand-in for what seedContent() and seedDemoAccounts() load from the database: the same shapes, with
// generated ids. It lets the demo-history generators run (and be tested) with no database, and powers `seed --dry-run`.
import { restaurantData } from '../data/restaurant.js';
import { ADD_ONS, CATEGORIES, DISHES, INGREDIENTS, SUPPLIERS } from '../data/menu.js';
import { TABLES, couponData } from '../data/content.js';
import { DEMO_CUSTOMERS, DEMO_STAFF } from '../accounts.js';
import { DAY, createIdFactory } from './helpers.js';

export function buildCatalogue({ now = new Date(), nextId = createIdFactory() } = {}) {
  const restaurant = restaurantData();
  const categories = new Map(CATEGORIES.map((c) => [c.slug, { _id: nextId(now), ...c }]));
  const addOns = new Map(ADD_ONS.map((a) => [a.key, { _id: nextId(now), active: true, ...a }]));
  const suppliers = new Map(SUPPLIERS.map((s) => [s.key, { _id: nextId(now), active: true, ...s }]));
  const ingredients = new Map(
    INGREDIENTS.map((i) => [
      i.key,
      {
        _id: nextId(now),
        key: i.key,
        sku: `ELAN-${i.key.toUpperCase()}`,
        name: i.name,
        unit: i.unit,
        stock: i.stock,
        lowStockThreshold: i.low,
        costPerUnit: i.cost,
        supplier: suppliers.get(i.supplier)._id,
        nearestExpiry: i.expiresInDays ? new Date(now.getTime() + i.expiresInDays * DAY) : null,
        perishable: Boolean(i.expiresInDays),
        active: true,
      },
    ]),
  );
  const menu = DISHES.map((d, index) => ({
    _id: nextId(now),
    slug: d.slug,
    name: d.name,
    nameBn: d.nameBn,
    category: { _id: categories.get(d.category)._id, name: categories.get(d.category).name, slug: d.category },
    price: d.price,
    salePrice: d.salePrice ?? null,
    art: { motif: d.motif, seed: d.seed },
    images: [],
    optionGroups: d.groups.map((key) => addOns.get(key)),
    tags: d.tags,
    prepMinutes: d.prep,
    featured: Boolean(d.featured),
    available: true,
    archived: false,
    sortOrder: index + 1,
    recipe: d.recipe.map((r) => ({ ingredient: ingredients.get(r.ingredient)._id, quantity: r.quantity })),
  }));
  const tables = TABLES.map((t) => ({ _id: nextId(now), active: true, qrToken: 'dry-run', ...t }));
  const coupons = new Map(couponData(now).map((c) => [c.code, { _id: nextId(now), ...c }]));
  const staff = Object.fromEntries(DEMO_STAFF.map((p) => [p.key, { _id: nextId(now), name: p.name, email: p.email, phone: p.phone, role: p.role }]));
  const customers = DEMO_CUSTOMERS.map((p) => ({
    _id: nextId(now),
    name: p.name,
    email: p.email,
    phone: p.phone,
    locale: p.locale,
    createdAt: new Date(now.getTime() - p.joined * DAY),
    profile: p,
  }));
  return { restaurant, categories, addOns, suppliers, ingredients, menu, tables, coupons, staff, customers, nextId };
}
