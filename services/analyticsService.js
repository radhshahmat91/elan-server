// Sales and guest analytics. The date logic and the assembly of numbers are pure (and unit tested);
// the aggregation pipelines only fetch the raw rows.
//
// Definitions (also written down in docs/api-documentation.md):
//   revenue  = total of orders that were delivered (or collected / served) in the period, by delivery time
//   orders   = orders placed in the period that reached the kitchen (everything except unpaid checkouts)
//   cancel % = cancelled + rejected orders divided by orders placed
import { ContactMessage, Conversation, Ingredient, Order, Reservation, Review, User } from '../models/index.js';
import { env } from '../config/env.js';
import { addDays, dateKey, daysBetween, fromLocal, startOfLocalDay } from '../utils/dates.js';
import { csvCell } from '../utils/format.js';

const PRESETS = { '7d': 7, '30d': 30, '90d': 90 };
const MAX_DAYS = 366;
const DAY_NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

/** '+06:00' style offset for Mongo's $dateToString / $hour. */
export function tzString(minutes = env.RESTAURANT_TZ_OFFSET_MINUTES) {
  const abs = Math.abs(minutes);
  return `${minutes < 0 ? '-' : '+'}${String(Math.floor(abs / 60)).padStart(2, '0')}:${String(abs % 60).padStart(2, '0')}`;
}

/** Pure. Turns { range } or { from, to } into inclusive restaurant-local day keys plus the preceding period of equal length. */
export function resolveRange({ range, from, to } = {}, now = new Date()) {
  const today = dateKey(now);
  let start;
  let end;
  if (from && to) {
    [start, end] = from <= to ? [from, to] : [to, from];
    if (end > today) end = today;
    if (start > end) start = end;
    if (daysBetween(start, end) + 1 > MAX_DAYS) start = addDays(end, -(MAX_DAYS - 1));
  } else {
    const days = PRESETS[range] ?? 30;
    end = today;
    start = addDays(today, -(days - 1));
  }
  const days = daysBetween(start, end) + 1;
  const previousEnd = addDays(start, -1);
  return { from: start, to: end, days, previous: { from: addDays(previousEnd, -(days - 1)), to: previousEnd } };
}

/** Real instants for a day-key range: [gte, lt). */
export const rangeBounds = ({ from, to }) => ({ gte: fromLocal(from), lt: fromLocal(addDays(to, 1)) });

/** Pure. Percentage change rounded to one decimal. null means "no earlier figure to compare with". */
export function pctChange(current, previous) {
  if (!(previous > 0)) return current > 0 ? null : 0;
  return Math.round(((current - previous) / previous) * 1000) / 10;
}

/** Pure. One row per day in the range, zero-filled. rows: [{ _id: 'YYYY-MM-DD', revenue, orders }] */
export function fillDailySeries(range, rows) {
  const byDay = new Map(rows.map((r) => [r._id, r]));
  const out = [];
  for (let i = 0; i < range.days; i += 1) {
    const date = addDays(range.from, i);
    const row = byDay.get(date);
    out.push({ date, revenue: row?.revenue ?? 0, orders: row?.orders ?? 0 });
  }
  return out;
}

const idToNumberMap = (rows, field = 'n') => new Map(rows.map((r) => [r._id, r[field]]));

/** Pure. Combines raw aggregation rows into the dashboard payload. */
export function assembleOverview({ range, daily, placed, delivered, items, previous, newCustomers, previousNewCustomers, reservations, topCustomers, repeat }) {
  const series = fillDailySeries(range, daily);
  const revenue = series.reduce((sum, d) => sum + d.revenue, 0);
  const deliveredOrders = series.reduce((sum, d) => sum + d.orders, 0);
  const status = idToNumberMap(placed.byStatus ?? []);
  const ordersPlaced = placed.total?.[0]?.n ?? 0;
  const cancelled = (status.get('cancelled') ?? 0) + (status.get('rejected') ?? 0);

  const hourOf = idToNumberMap(placed.hours ?? []);
  const placedDay = idToNumberMap(placed.weekdays ?? []);
  const dayRows = new Map((delivered.weekdays ?? []).map((r) => [r._id, r]));

  const resv = new Map((reservations ?? []).map((r) => [r._id, r]));
  const resvTotal = [...resv.values()].reduce((sum, r) => sum + r.n, 0);
  const noShows = resv.get('no_show')?.n ?? 0;
  const covers = ['seated', 'completed'].reduce((sum, s) => sum + (resv.get(s)?.guests ?? 0), 0);

  return {
    range: { from: range.from, to: range.to, days: range.days },
    kpis: {
      revenue,
      orders: ordersPlaced,
      delivered: deliveredOrders,
      averageOrder: deliveredOrders ? Math.round(revenue / deliveredOrders) : 0,
      cancelRate: ordersPlaced ? Math.round((cancelled / ordersPlaced) * 1000) / 10 : 0,
      newCustomers,
      repeatRate: repeat?.customers ? Math.round((repeat.repeat / repeat.customers) * 1000) / 10 : 0,
      reservations: resvTotal,
      covers,
      noShowRate: resvTotal ? Math.round((noShows / resvTotal) * 1000) / 10 : 0,
    },
    change: {
      revenue: pctChange(revenue, previous?.revenue ?? 0),
      orders: pctChange(deliveredOrders, previous?.orders ?? 0),
      averageOrder: pctChange(deliveredOrders ? Math.round(revenue / deliveredOrders) : 0, previous?.orders ? Math.round((previous.revenue ?? 0) / previous.orders) : 0),
      newCustomers: pctChange(newCustomers, previousNewCustomers ?? 0),
    },
    series,
    byFulfillment: (delivered.fulfillment ?? []).map((r) => ({ key: r._id, orders: r.orders, revenue: r.revenue })).sort((a, b) => b.revenue - a.revenue),
    byPayment: (delivered.payment ?? []).map((r) => ({ key: r._id, orders: r.orders, revenue: r.revenue })).sort((a, b) => b.revenue - a.revenue),
    byStatus: [...status].map(([key, count]) => ({ status: key, count })).sort((a, b) => b.count - a.count),
    hours: Array.from({ length: 24 }, (_, hour) => ({ hour, orders: hourOf.get(hour) ?? 0 })),
    weekdays: DAY_NAMES.map((name, index) => ({ day: index, name, orders: placedDay.get(index + 1) ?? 0, revenue: dayRows.get(index + 1)?.revenue ?? 0 })),
    topItems: (items.items ?? []).map((r) => ({ id: r._id ? String(r._id) : undefined, name: r.name, category: r.category || undefined, quantity: r.quantity, revenue: r.revenue })),
    categories: (items.categories ?? []).map((r) => ({ name: r._id || 'Other', quantity: r.quantity, revenue: r.revenue })),
    topCustomers: topCustomers ?? [],
  };
}

export async function getOverview(query = {}) {
  const range = resolveRange(query);
  const tz = tzString();
  const { gte, lt } = rangeBounds(range);
  const prev = rangeBounds(range.previous);
  const deliveredMatch = { status: 'delivered', deliveredAt: { $gte: gte, $lt: lt } };
  const placedMatch = { status: { $ne: 'pending_payment' }, placedAt: { $gte: gte, $lt: lt } };

  const [daily, placedFacet, deliveredFacet, itemFacet, previousRow, newCustomers, previousNewCustomers, reservations, topRows, repeatRow] = await Promise.all([
    Order.aggregate([
      { $match: deliveredMatch },
      { $group: { _id: { $dateToString: { format: '%Y-%m-%d', date: '$deliveredAt', timezone: tz } }, revenue: { $sum: '$totals.total' }, orders: { $sum: 1 } } },
    ]),
    Order.aggregate([
      { $match: placedMatch },
      {
        $facet: {
          total: [{ $count: 'n' }],
          byStatus: [{ $group: { _id: '$status', n: { $sum: 1 } } }],
          hours: [{ $group: { _id: { $hour: { date: '$placedAt', timezone: tz } }, n: { $sum: 1 } } }],
          weekdays: [{ $group: { _id: { $dayOfWeek: { date: '$placedAt', timezone: tz } }, n: { $sum: 1 } } }],
        },
      },
    ]),
    Order.aggregate([
      { $match: deliveredMatch },
      {
        $facet: {
          fulfillment: [{ $group: { _id: '$fulfillment', orders: { $sum: 1 }, revenue: { $sum: '$totals.total' } } }],
          payment: [{ $group: { _id: '$payment.method', orders: { $sum: 1 }, revenue: { $sum: '$totals.total' } } }],
          weekdays: [{ $group: { _id: { $dayOfWeek: { date: '$deliveredAt', timezone: tz } }, orders: { $sum: 1 }, revenue: { $sum: '$totals.total' } } }],
        },
      },
    ]),
    Order.aggregate([
      { $match: deliveredMatch },
      { $unwind: '$items' },
      {
        $facet: {
          items: [
            { $group: { _id: '$items.menuItem', name: { $first: '$items.name' }, category: { $first: '$items.categoryName' }, quantity: { $sum: '$items.quantity' }, revenue: { $sum: '$items.lineTotal' } } },
            { $sort: { revenue: -1 } },
            { $limit: 8 },
          ],
          categories: [{ $group: { _id: '$items.categoryName', quantity: { $sum: '$items.quantity' }, revenue: { $sum: '$items.lineTotal' } } }, { $sort: { revenue: -1 } }, { $limit: 8 }],
        },
      },
    ]),
    Order.aggregate([{ $match: { status: 'delivered', deliveredAt: { $gte: prev.gte, $lt: prev.lt } } }, { $group: { _id: null, revenue: { $sum: '$totals.total' }, orders: { $sum: 1 } } }]),
    User.countDocuments({ role: 'customer', status: { $ne: 'deleted' }, createdAt: { $gte: gte, $lt: lt } }),
    User.countDocuments({ role: 'customer', status: { $ne: 'deleted' }, createdAt: { $gte: prev.gte, $lt: prev.lt } }),
    Reservation.aggregate([{ $match: { date: { $gte: range.from, $lte: range.to } } }, { $group: { _id: '$status', n: { $sum: 1 }, guests: { $sum: '$guests' } } }]),
    Order.aggregate([{ $match: { ...deliveredMatch, user: { $ne: null } } }, { $group: { _id: '$user', orders: { $sum: 1 }, spent: { $sum: '$totals.total' } } }, { $sort: { spent: -1 } }, { $limit: 5 }]),
    Order.aggregate([
      { $match: { ...deliveredMatch, user: { $ne: null } } },
      { $group: { _id: '$user', orders: { $sum: 1 } } },
      { $group: { _id: null, customers: { $sum: 1 }, repeat: { $sum: { $cond: [{ $gte: ['$orders', 2] }, 1, 0] } } } },
    ]),
  ]);

  const names = topRows.length ? await User.find({ _id: { $in: topRows.map((r) => r._id) } }).select('name').lean() : [];
  const nameOf = new Map(names.map((u) => [String(u._id), u.name]));
  return assembleOverview({
    range,
    daily,
    placed: placedFacet[0] ?? {},
    delivered: deliveredFacet[0] ?? {},
    items: itemFacet[0] ?? {},
    previous: previousRow[0],
    newCustomers,
    previousNewCustomers,
    reservations,
    topCustomers: topRows.map((r) => ({ id: String(r._id), name: nameOf.get(String(r._id)) ?? 'Guest', orders: r.orders, spent: r.spent })),
    repeat: repeatRow[0],
  });
}

/** Live numbers for the top of the dashboard. */
export async function getToday() {
  const start = startOfLocalDay(new Date());
  const end = new Date(start.getTime() + 86_400_000);
  const today = dateKey();
  const [byStatus, revenueRow, active, reservationsToday, pendingReservations, lowStock, unreadChats, newMessages, pendingReviews, recent] = await Promise.all([
    Order.aggregate([{ $match: { placedAt: { $gte: start, $lt: end }, status: { $ne: 'pending_payment' } } }, { $group: { _id: '$status', n: { $sum: 1 } } }]),
    Order.aggregate([{ $match: { status: 'delivered', deliveredAt: { $gte: start, $lt: end } } }, { $group: { _id: null, revenue: { $sum: '$totals.total' }, orders: { $sum: 1 } } }]),
    Order.countDocuments({ status: { $in: ['placed', 'confirmed', 'preparing', 'ready', 'out_for_delivery'] } }),
    Reservation.aggregate([{ $match: { date: today, status: { $in: ['pending', 'confirmed', 'seated'] } } }, { $group: { _id: null, n: { $sum: 1 }, guests: { $sum: '$guests' } } }]),
    Reservation.countDocuments({ status: 'pending', date: { $gte: today } }),
    Ingredient.countDocuments({ active: true, lowStockThreshold: { $gt: 0 }, $expr: { $lte: ['$stock', '$lowStockThreshold'] } }),
    Conversation.aggregate([{ $match: { status: 'open', unreadForStaff: { $gt: 0 } } }, { $group: { _id: null, n: { $sum: '$unreadForStaff' } } }]),
    ContactMessage.countDocuments({ status: 'new' }),
    Review.countDocuments({ status: 'pending' }),
    Order.find({ status: { $ne: 'pending_payment' } }).sort({ createdAt: -1 }).limit(8).lean(),
  ]);
  const status = Object.fromEntries(byStatus.map((r) => [r._id, r.n]));
  return {
    orders: { today: byStatus.reduce((sum, r) => sum + r.n, 0), active, byStatus: status },
    revenueToday: revenueRow[0]?.revenue ?? 0,
    deliveredToday: revenueRow[0]?.orders ?? 0,
    reservations: { today: reservationsToday[0]?.n ?? 0, guestsToday: reservationsToday[0]?.guests ?? 0, pending: pendingReservations },
    attention: { lowStock, unreadChats: unreadChats[0]?.n ?? 0, newMessages, pendingReviews },
    recentOrders: recent.map((o) => ({
      id: String(o._id),
      publicId: o.publicId,
      orderNumber: o.orderNumber,
      status: o.status,
      fulfillment: o.fulfillment,
      total: o.totals?.total ?? 0,
      customerName: o.customer?.name,
      itemCount: (o.items ?? []).reduce((n, i) => n + (i.quantity ?? 0), 0),
      createdAt: o.createdAt,
    })),
  };
}

export const CSV_COLUMNS = ['Order', 'Delivered at', 'Fulfilment', 'Payment', 'Items', 'Subtotal', 'Coupon', 'Points', 'Delivery fee', 'Service charge', 'VAT', 'Total'];

/** Pure. One CSV line per order (whole BDT, ISO times, formula-safe cells). */
export function orderCsvRow(o) {
  const t = o.totals ?? {};
  return [
    o.orderNumber,
    o.deliveredAt ? new Date(o.deliveredAt).toISOString() : '',
    o.fulfillment,
    o.payment?.method,
    (o.items ?? []).reduce((n, i) => n + (i.quantity ?? 0), 0),
    t.subtotal ?? 0,
    t.discount ?? 0,
    t.loyaltyDiscount ?? 0,
    t.deliveryFee ?? 0,
    t.serviceCharge ?? 0,
    t.tax ?? 0,
    t.total ?? 0,
  ]
    .map(csvCell)
    .join(',');
}

export async function exportOrdersCsv(query = {}) {
  const range = resolveRange(query);
  const { gte, lt } = rangeBounds(range);
  const rows = await Order.find({ status: 'delivered', deliveredAt: { $gte: gte, $lt: lt } }).sort({ deliveredAt: 1 }).limit(20_000).lean();
  const body = [CSV_COLUMNS.join(','), ...rows.map(orderCsvRow)].join('\r\n');
  return { filename: `elan-orders-${range.from}-to-${range.to}.csv`, content: `﻿${body}\r\n` }; // BOM so Excel reads UTF-8
}
