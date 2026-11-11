// Stock: recipe-driven deduction when an order starts cooking, manual adjustments, and low-stock alerts.
import { Ingredient, MenuItem, Order, StockTransaction } from '../models/index.js';
import { EVENTS, emitToRoom, rooms } from '../sockets/events.js';
import { notifyStaff } from './notificationService.js';
import { getRestaurant } from './restaurantService.js';
import { conflict, notFound } from '../utils/errors.js';
import { logger } from '../utils/logger.js';

/** Pure. Total ingredient need for an order: Map(ingredientId -> quantity). */
export function ingredientNeeds(orderItems, menuItemsById) {
  const needs = new Map();
  for (const line of orderItems) {
    const item = menuItemsById.get(String(line.menuItem));
    for (const part of item?.recipe ?? []) {
      const key = String(part.ingredient);
      needs.set(key, (needs.get(key) ?? 0) + part.quantity * line.quantity);
    }
  }
  return needs;
}

/** Raises the alert once, when stock crosses to or below the threshold. */
async function checkLowStock(ingredient, before) {
  if (ingredient.lowStockThreshold <= 0) return;
  const crossed = before > ingredient.lowStockThreshold && ingredient.stock <= ingredient.lowStockThreshold;
  if (!crossed) return;
  emitToRoom(rooms.admin, EVENTS.STOCK_LOW, { id: String(ingredient._id), name: ingredient.name, stock: ingredient.stock, unit: ingredient.unit });
  await notifyStaff(
    { type: 'stock', title: `Low stock: ${ingredient.name}`, body: `${ingredient.stock} ${ingredient.unit} left (alert at ${ingredient.lowStockThreshold}).`, link: '/admin/inventory' },
    { roles: ['manager', 'owner', 'chef'] },
  );
}

/**
 * Called when an order reaches `preparing`. Idempotent via order.stockDeducted.
 * Decrements each recipe ingredient atomically, writes StockTransaction rows, then runs the low-stock checks.
 */
export async function deductStockForOrder(order, actor) {
  const flipped = await Order.findOneAndUpdate({ _id: order._id, stockDeducted: false }, { $set: { stockDeducted: true } });
  if (!flipped) return { deducted: false };

  const ids = order.items.map((i) => i.menuItem).filter(Boolean);
  const items = await MenuItem.find({ _id: { $in: ids } }).select('recipe').lean();
  const needs = ingredientNeeds(order.items, new Map(items.map((i) => [String(i._id), i])));
  const restaurant = await getRestaurant();

  for (const [ingredientId, quantity] of needs) {
    if (!(quantity > 0)) continue;
    const after = await Ingredient.findOneAndUpdate({ _id: ingredientId }, { $inc: { stock: -quantity } }, { new: true });
    if (!after) continue;
    const before = after.stock + quantity;
    let balance = after.stock;
    if (balance < 0) {
      await Ingredient.updateOne({ _id: ingredientId, stock: { $lt: 0 } }, { $set: { stock: 0 } });
      balance = 0;
    }
    await StockTransaction.create({
      ingredient: ingredientId,
      type: 'order',
      quantity: -quantity,
      balanceAfter: balance,
      reason: `Order ${order.orderNumber}`,
      order: order._id,
      by: actor?.id ? { id: actor.id, name: actor.name } : undefined,
    });
    await checkLowStock({ ...after.toObject(), stock: balance }, before);
    if (restaurant.autoDisableOutOfStock && balance <= 0) {
      await MenuItem.updateMany({ 'recipe.ingredient': ingredientId }, { $set: { available: false } });
      logger.info('menu items hidden: ingredient out of stock', { ingredient: after.name });
    }
  }
  return { deducted: true };
}

/** Manual stock movement from the admin area. Positive = stock in, negative = usage or waste. */
export async function adjustStock({ ingredientId, quantity, type = 'adjust', reason, supplierId, unitCost, actor }) {
  const delta = Number(quantity);
  if (!Number.isFinite(delta) || delta === 0) throw conflict('Enter a quantity other than zero.', 'BAD_QUANTITY');
  const filter = { _id: ingredientId };
  if (delta < 0) filter.stock = { $gte: -delta };
  const after = await Ingredient.findOneAndUpdate(filter, { $inc: { stock: delta } }, { new: true });
  if (!after) {
    if (await Ingredient.exists({ _id: ingredientId })) throw conflict('That would take the stock below zero.', 'INSUFFICIENT_STOCK');
    throw notFound('Ingredient not found.');
  }
  await StockTransaction.create({
    ingredient: ingredientId,
    type,
    quantity: delta,
    balanceAfter: after.stock,
    reason,
    supplier: supplierId || undefined,
    unitCost: unitCost ?? undefined,
    by: actor?.id ? { id: actor.id, name: actor.name } : undefined,
  });
  await checkLowStock(after, after.stock - delta);
  return after;
}

/** Ingredients at or below their alert level (and those expiring within 3 days). */
export async function lowStockList() {
  const soon = new Date(Date.now() + 3 * 86_400_000);
  const rows = await Ingredient.find({ active: true, $or: [{ $expr: { $lte: ['$stock', '$lowStockThreshold'] } }, { nearestExpiry: { $ne: null, $lte: soon } }] })
    .sort({ name: 1 })
    .lean();
  return rows.filter((r) => r.lowStockThreshold > 0 || r.nearestExpiry);
}
