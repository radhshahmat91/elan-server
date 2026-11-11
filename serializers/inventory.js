// Stock DTOs and the small pure rules behind them (status, expiry). No database access here.
const DAY = 86_400_000;
const round3 = (n) => Math.round((Number(n) || 0) * 1000) / 1000;
const dayKey = (date) => (date ? new Date(date).toISOString().slice(0, 10) : null);

/** 'out' at zero, 'low' at or under the alert level, otherwise 'ok'. */
export function stockStatus(ingredient) {
  const stock = Number(ingredient.stock) || 0;
  if (stock <= 0) return 'out';
  if (ingredient.lowStockThreshold > 0 && stock <= ingredient.lowStockThreshold) return 'low';
  return 'ok';
}

/** Whole days from `now` until `date` (negative once past). null when there is no date. */
export function daysUntil(date, now = new Date()) {
  if (!date) return null;
  return Math.ceil((new Date(date).getTime() - now.getTime()) / DAY);
}

export function expiryState(days) {
  if (days == null) return 'none';
  if (days < 0) return 'expired';
  if (days <= 3) return 'soon';
  return 'ok';
}

export function serializeSupplier(s) {
  const o = typeof s.toObject === 'function' ? s.toObject() : s;
  return {
    id: String(o._id),
    name: o.name,
    contactName: o.contactName || undefined,
    phone: o.phone || undefined,
    email: o.email || undefined,
    address: o.address || undefined,
    notes: o.notes || undefined,
    active: o.active !== false,
  };
}

export function serializeIngredient(i, now = new Date()) {
  const o = typeof i.toObject === 'function' ? i.toObject() : i;
  const populated = o.supplier && typeof o.supplier === 'object' && o.supplier.name;
  const days = daysUntil(o.nearestExpiry, now);
  const stock = round3(o.stock);
  return {
    id: String(o._id),
    name: o.name,
    sku: o.sku || undefined,
    unit: o.unit,
    stock,
    lowStockThreshold: o.lowStockThreshold ?? 0,
    costPerUnit: o.costPerUnit ?? 0,
    value: Math.round(Math.max(stock, 0) * (o.costPerUnit ?? 0)),
    status: stockStatus(o),
    supplier: o.supplier ? { id: String(populated ? o.supplier._id : o.supplier), name: populated ? o.supplier.name : undefined } : null,
    nearestExpiry: dayKey(o.nearestExpiry),
    expiresInDays: days,
    expiry: expiryState(days),
    active: o.active !== false,
  };
}

export function serializeStockTransaction(t) {
  const o = typeof t.toObject === 'function' ? t.toObject() : t;
  const ingredient = o.ingredient && typeof o.ingredient === 'object' && o.ingredient.name ? { id: String(o.ingredient._id), name: o.ingredient.name, unit: o.ingredient.unit } : undefined;
  return {
    id: String(o._id),
    type: o.type,
    quantity: round3(o.quantity),
    balanceAfter: round3(o.balanceAfter),
    reason: o.reason || undefined,
    unitCost: o.unitCost ?? undefined,
    by: o.by?.name || undefined,
    orderId: o.order ? String(o.order) : undefined,
    ingredient,
    createdAt: o.createdAt,
  };
}

/**
 * Pure. The signed quantity for a stock movement as the admin form describes it:
 * "received" and "used"/"wasted" are entered as positive amounts, a correction keeps its own sign.
 */
export function signedQuantity(type, quantity) {
  const q = Number(quantity);
  if (!Number.isFinite(q) || q === 0) return 0;
  if (type === 'in') return Math.abs(q);
  if (type === 'out' || type === 'waste') return -Math.abs(q);
  return q; // adjust
}
