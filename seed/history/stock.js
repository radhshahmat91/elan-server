// The stock ledger behind the demo orders. Pure and deterministic.
//
// Every dish an order used is a real "order" movement (the same recipe maths the live system runs), and the quantities
// delivered by suppliers are sized to cover what was used, so the history is consistent with the stock levels the
// content seed curated: the running balance always lands on today's quantity, and never dips below it on the way.
import { addDays, dateKey } from '../../utils/dates.js';
import { MIN, addMinutes, localAt, round3 } from './helpers.js';

const WASTE_REASONS = ['Past its best, binned', 'Dropped during prep', 'Spoiled in the cold room', 'Trimmed and discarded'];

const stepFor = (unit) => (unit === 'pcs' ? 1 : 0.1);
const roundUp = (value, step) => round3(Math.ceil(round3(value / step)) * step);

/**
 * @param {object} input
 * @param {Date} input.now
 * @param {object} input.rand
 * @param {object[]} input.ingredients   [{ _id, name, unit, stock, costPerUnit, supplier, nearestExpiry }]
 * @param {Map<string,string>} input.supplierNames  supplier id -> name
 * @param {object[]} input.usage         generateOrders().stockUsage
 * @param {{ manager: object, chef: object }} input.staff
 * @returns {object[]} StockTransaction documents, oldest first
 */
export function buildStockLedger({ now, rand, ingredients, supplierNames, usage, staff, days = 46 }) {
  const todayKey = dateKey(now);
  const startKey = addDays(todayKey, -days);
  const manager = { id: staff.manager._id, name: staff.manager.name };
  const chef = { id: staff.chef._id, name: staff.chef.name };
  const rows = [];

  for (const ingredient of ingredients) {
    const id = String(ingredient._id);
    const perishable = Boolean(ingredient.nearestExpiry);
    const step = stepFor(ingredient.unit);
    const closing = ingredient.stock;

    // Movements that are not deliveries: dishes cooked, and a little waste.
    const events = [];
    let used = 0;
    for (const u of usage) {
      const need = u.needs.get(id);
      if (!(need > 0)) continue;
      used += need;
      events.push({ at: u.at, type: 'order', quantity: -round3(need), order: u.orderId, reason: `Order ${u.orderNumber}`, by: u.by });
    }
    if (perishable) {
      const count = rand.int(2, 4);
      for (let i = 0; i < count; i += 1) {
        const amount = ingredient.unit === 'pcs' ? rand.int(1, 3) : round3(Math.max(0.1, Math.min(used * 0.04, 1.5)) * (0.6 + rand.next() * 0.8));
        const at = localAt(addDays(todayKey, -rand.int(3, 40)), 22 * 60 + rand.int(0, 30));
        events.push({ at, type: 'waste', quantity: -(ingredient.unit === 'pcs' ? amount : roundUp(amount, 0.1)), reason: rand.pick(WASTE_REASONS), by: rand.chance(0.5) ? chef : manager });
      }
    }
    events.sort((a, b) => a.at - b.at);

    // Deliveries: one at the start of each buying period, sized to cover the use and waste in that period.
    const periodDays = perishable ? 4 : 7;
    const supplierName = supplierNames.get(String(ingredient.supplier)) ?? 'the supplier';
    const deliveries = [];
    for (let offset = -days + 1; offset <= 0; offset += periodDays) {
      const from = localAt(addDays(todayKey, offset), 0);
      const to = localAt(addDays(todayKey, Math.min(offset + periodDays, 1)), 0);
      const inside = events.filter((e) => e.at >= from && e.at < to);
      if (inside.length === 0) continue;
      const need = roundUp(-inside.reduce((sum, e) => sum + e.quantity, 0), step);
      const planned = addMinutes(from, 7 * 60 + 30 + rand.int(0, 45));
      const at = new Date(Math.min(planned.getTime(), inside[0].at.getTime() - 5 * MIN));
      deliveries.push({
        at,
        type: 'in',
        quantity: need,
        reason: `Delivery from ${supplierName}`,
        supplier: ingredient.supplier,
        unitCost: Math.round(ingredient.costPerUnit * (0.96 + rand.next() * 0.1)),
        by: manager,
      });
    }

    // Walk forward from the opening balance (which equals today's quantity) and finish with a small stock-take
    // correction for whatever rounding left behind, so the last balance is exactly today's stock.
    const opening = { at: localAt(startKey, 9 * 60), type: 'in', quantity: closing, reason: 'Opening stock', supplier: ingredient.supplier, unitCost: ingredient.costPerUnit, by: manager };
    const timeline = [opening, ...[...events, ...deliveries].sort((a, b) => a.at - b.at)];
    let balance = 0;
    for (const e of timeline) {
      balance = round3(balance + e.quantity);
      rows.push({ ingredient: ingredient._id, ...e, balanceAfter: balance, isDemo: true, createdAt: e.at, updatedAt: e.at });
    }
    const residual = round3(closing - balance);
    if (residual !== 0) {
      const at = addMinutes(now, -5); // after the last movement of the live orders
      rows.push({ ingredient: ingredient._id, at, type: 'adjust', quantity: residual, reason: 'Stock take: counted by hand', by: manager, balanceAfter: closing, isDemo: true, createdAt: at, updatedAt: at });
    }
  }
  return rows.sort((a, b) => a.createdAt - b.createdAt).map(({ at, ...row }) => row);
}
