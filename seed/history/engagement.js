// Everything around the orders in the demo history: reservations, reviews, chat threads, notifications, the audit trail,
// contact messages, newsletter subscribers and one saved cart. Pure and deterministic, like the order generator.
import { addDays, dateKey, fromLocal, weekdayOf } from '../../utils/dates.js';
import {
  AUDIT, CHATS, CONTACTS, GENERIC_ITEM_REVIEWS, GUESTS, ITEM_REVIEWS, OCCASIONS, REQUESTS, REVIEW_REPLIES, SPAM_REVIEW, VISIT_REVIEWS,
} from '../data/stories.js';
import { ALNUM, DAY, HOUR, LOWER, MIN, UPPER, addMinutes } from './helpers.js';

const BOT_ACK = {
  en: 'Thank you, we have your message. A member of the team will reply here as soon as they can, usually within a few minutes while we are open.',
  bn: 'ধন্যবাদ, আপনার বার্তা পেয়েছি। আমাদের একজন সদস্য যত দ্রুত সম্ভব এখানেই উত্তর দেবেন, খোলা থাকলে সাধারণত কয়েক মিনিটের মধ্যে।',
};

const unique = (set, make) => {
  for (let i = 0; i < 50; i += 1) {
    const value = make();
    if (!set.has(value)) {
      set.add(value);
      return value;
    }
  }
  throw new Error('Could not generate a unique identifier for the demo data.');
};

// ------------------------------------------------------------------------------------------------ reservations
export function generateReservations({ now, rand, nextId, restaurant, tables, staff, customers, back = 14, ahead = 21 }) {
  const todayKey = dateKey(now);
  const seatings = restaurant.reservation.seatings;
  const duration = restaurant.reservation.seatingDurationMin;
  const seatingWeights = { '12:00': 6, '13:30': 12, '15:00': 3, '18:00': 14, '19:30': 34, '21:00': 26 };
  const activeTables = tables.filter((t) => t.active !== false).sort((a, b) => a.capacity - b.capacity);
  const regulars = customers.filter((c) => c.profile.weight > 0);
  const manager = { id: staff.manager._id, name: staff.manager.name, role: 'manager' };
  const taken = new Set();
  const codes = new Set();
  const publicIds = new Set();
  const out = [];

  for (let offset = -back; offset <= ahead; offset += 1) {
    const key = addDays(todayKey, offset);
    const weekday = weekdayOf(key);
    const hours = restaurant.hours.find((h) => h.day === weekday);
    if (!hours || hours.closed) continue;
    let count = weekday === 5 || weekday === 6 ? rand.weighted([[3, 2], [4, 3], [5, 2]]) : rand.weighted([[1, 3], [2, 3], [3, 2]]);
    if (offset === 0) count = Math.max(count, 5);

    for (let i = 0; i < count; i += 1) {
      const seating = rand.weighted(seatings.map((s) => [s, seatingWeights[s] ?? 5]));
      const guests = rand.weighted([[2, 38], [3, 10], [4, 28], [5, 6], [6, 9], [8, 5], [10, 3], [12, 1]]);
      const preference = guests >= 8 ? 'private' : rand.weighted([['any', 60], ['window', 15], ['indoor', 10], ['outdoor', 10]]);
      const table = activeTables.find((t) => t.capacity >= guests && (preference === 'any' || t.section === preference) && !taken.has(`${t._id}:${key}:${seating}`));
      if (!table) continue;

      const startsAt = fromLocal(key, seating);
      const endsAt = addMinutes(startsAt, duration);
      const future = startsAt > now;
      const ongoing = !future && endsAt > now;
      const final = ongoing
        ? 'seated'
        : future
          ? rand.weighted([['confirmed', 86], ['pending', 6], ['cancelled', 8]])
          : rand.weighted([['completed', 78], ['no_show', 7], ['cancelled', 15]]);

      const user = rand.chance(0.55) ? rand.pick(regulars) : null;
      const guest = user ? null : rand.pick(GUESTS);
      const lead = rand.int(1, 10) * DAY + rand.int(0, 8) * HOUR;
      const createdAt = new Date(Math.min(startsAt.getTime() - lead, now.getTime() - 5 * MIN));
      const bookedBy = user ? { id: user._id, name: user.name, role: 'customer' } : { name: 'Guest', role: 'guest' };
      const initial = final === 'pending' ? 'pending' : 'confirmed';
      const history = [{ status: initial, at: createdAt, by: bookedBy }];
      let updatedAt = createdAt;
      const step = (status, at, by, note) => {
        history.push({ status, at, by, note });
        updatedAt = at;
      };
      if (final === 'completed') {
        step('seated', addMinutes(startsAt, rand.int(0, 12)), manager);
        step('completed', addMinutes(endsAt, -rand.int(5, 20)), manager);
      } else if (final === 'seated') {
        step('seated', addMinutes(startsAt, rand.int(0, 10)), manager);
      } else if (final === 'no_show') {
        step('no_show', addMinutes(startsAt, 20), manager, 'Did not arrive within 15 minutes');
      } else if (final === 'cancelled') {
        const span = Math.max(0, startsAt.getTime() - 4 * HOUR - createdAt.getTime());
        const at = new Date(Math.min(createdAt.getTime() + span * (0.2 + rand.next() * 0.5), now.getTime() - MIN));
        step('cancelled', at, bookedBy);
      }

      const holdsTable = final !== 'cancelled' && final !== 'no_show';
      if (holdsTable) taken.add(`${table._id}:${key}:${seating}`);
      out.push({
        _id: nextId(createdAt),
        code: unique(codes, () => `RV-${rand.code(UPPER, 6)}`),
        publicId: unique(publicIds, () => rand.code(LOWER, 14)),
        user: user?._id ?? null,
        guestName: user ? user.name : guest.name,
        phone: user ? user.phone : guest.phone,
        email: user ? user.email : guest.email,
        date: key,
        seating,
        startsAt,
        endsAt,
        guests,
        table: table._id,
        seatingPreference: preference === 'private' ? 'private' : preference,
        occasion: rand.chance(0.25) ? rand.pick(OCCASIONS) : undefined,
        specialRequests: rand.chance(0.22) ? rand.pick(REQUESTS) : undefined,
        status: final,
        history,
        holdsTable,
        isDemo: true,
        createdAt,
        updatedAt,
      });
    }
  }
  return out;
}

// ------------------------------------------------------------------------------------------------ reviews
export function generateReviews({ now, rand, nextId, orders, customers }) {
  const byUser = new Map(customers.map((c) => [String(c._id), c]));
  const delivered = orders.filter((o) => o.status === 'delivered' && o.user);
  const reviews = [];
  const reviewed = new Set();

  for (const order of delivered) {
    if (!rand.chance(0.5)) continue;
    const user = byUser.get(String(order.user));
    if (!user) continue;
    let entry;
    let menuItem = null;
    if (rand.chance(0.5)) {
      const line = rand.pick(order.items);
      menuItem = line.menuItem;
      const pool = ITEM_REVIEWS[line.slug];
      if (pool && rand.chance(0.8)) {
        entry = rand.pick(pool);
      } else {
        const rating = rand.weighted([[5, 55], [4, 35], [3, 10]]);
        entry = { rating, ...rand.pick(GENERIC_ITEM_REVIEWS[rating]) };
      }
    } else {
      const rating = rand.weighted([[5, 52], [4, 28], [3, 10], [2, 6], [1, 4]]);
      entry = { rating, ...rand.pick(VISIT_REVIEWS[rating]) };
    }
    const createdAt = new Date(Math.min(order.deliveredAt.getTime() + rand.int(120, 3 * 24 * 60) * MIN, now.getTime() - 10 * MIN));
    const recent = now.getTime() - order.deliveredAt.getTime() < 4 * DAY;
    const status = recent && rand.chance(0.7) ? 'pending' : 'approved';
    let reply;
    if (status === 'approved' && (entry.rating <= 3 || rand.chance(0.2))) {
      const low = entry.rating <= 3;
      reply = { text: low ? REVIEW_REPLIES.low : REVIEW_REPLIES.high, by: low ? REVIEW_REPLIES.by.low : REVIEW_REPLIES.by.high, at: new Date(Math.min(createdAt.getTime() + DAY, now.getTime() - MIN)) };
    }
    reviewed.add(String(order._id));
    reviews.push({
      _id: nextId(createdAt), user: user._id, order: order._id, menuItem, rating: entry.rating, title: entry.title, body: entry.body,
      status, verifiedPurchase: true, reply, authorName: user.name, isDemo: true, createdAt, updatedAt: reply?.at ?? createdAt,
    });
  }

  // One spam review that the moderator rejected.
  const spamOrder = delivered.find((o) => !reviewed.has(String(o._id)) && now.getTime() - o.deliveredAt.getTime() > 12 * DAY);
  if (spamOrder) {
    const user = byUser.get(String(spamOrder.user));
    const createdAt = addMinutes(spamOrder.deliveredAt, 60 * 30);
    reviews.push({
      _id: nextId(createdAt), user: user._id, order: spamOrder._id, menuItem: null, ...SPAM_REVIEW, status: 'rejected', verifiedPurchase: true,
      authorName: user.name, isDemo: true, createdAt, updatedAt: createdAt,
    });
  }

  // The cached rating on each dish is the average of its approved reviews, exactly as recomputeItemRating() does it.
  const sums = new Map();
  for (const r of reviews) {
    if (r.status !== 'approved' || !r.menuItem) continue;
    const key = String(r.menuItem);
    const cell = sums.get(key) ?? { sum: 0, count: 0 };
    cell.sum += r.rating;
    cell.count += 1;
    sums.set(key, cell);
  }
  const ratings = [...sums].map(([id, { sum, count }]) => ({ id, avg: Math.round((sum / count) * 10) / 10, count }));
  return { reviews, ratings };
}

// ------------------------------------------------------------------------------------------------ chat
export function generateChats({ now, nextId, customers, staff }) {
  const byKey = new Map(customers.map((c) => [c.profile.key, c]));
  const conversations = [];
  const messages = [];
  for (const chat of CHATS) {
    const customer = byKey.get(chat.customer);
    if (!customer) continue;
    const conversationId = nextId(now);
    let at = addMinutes(now, -chat.startedMinutesAgo);
    const built = [];
    for (const line of chat.lines) {
      at = addMinutes(at, line.after);
      const base = { _id: nextId(at), conversation: conversationId, createdAt: at, updatedAt: at };
      if (line.from === 'customer') built.push({ ...base, sender: customer._id, senderRole: 'customer', senderName: customer.name, body: line.body });
      else if (line.from === 'staff') built.push({ ...base, sender: staff.manager._id, senderRole: 'staff', senderName: staff.manager.name, body: line.body });
      else built.push({ ...base, sender: null, senderRole: 'bot', senderName: 'ÉLAN', body: BOT_ACK[customer.locale === 'bn' ? 'bn' : 'en'] });
    }
    const last = built[built.length - 1];
    const open = chat.status === 'open';
    // Trailing messages the other side has not read yet.
    let trailing = 0;
    for (let i = built.length - 1; i >= 0 && built[i].senderRole === last.senderRole; i -= 1) trailing += 1;
    const unreadForStaff = open && last.senderRole === 'customer' ? trailing : 0;
    const unreadForCustomer = open && last.senderRole === 'staff' ? trailing : 0;
    built.forEach((m, index) => {
      const unread = index >= built.length - (unreadForStaff || unreadForCustomer);
      m.readAt = unread && (unreadForStaff || unreadForCustomer) ? null : addMinutes(m.createdAt, 3);
    });
    messages.push(...built);
    conversations.push({
      _id: conversationId, user: customer._id, status: chat.status, subject: chat.subject, assignedTo: chat.assignedTo ? staff[chat.assignedTo]._id : null,
      lastMessageAt: last.createdAt, lastMessagePreview: last.body.slice(0, 160), unreadForStaff, unreadForCustomer, isDemo: true,
      createdAt: built[0].createdAt, updatedAt: last.createdAt,
    });
  }
  return { conversations, messages };
}

// ------------------------------------------------------------------------------------------------ notifications
export function generateNotifications({ now, nextId, orders, reviews, reservations, customers, lowStock }) {
  const out = [];
  const reviewedOrders = new Set(reviews.map((r) => String(r.order)));
  const push = (n) => out.push({ _id: nextId(n.createdAt), audience: 'user', email: { status: 'none' }, isDemo: true, updatedAt: n.createdAt, ...n });

  for (const customer of customers) {
    push({ user: customer._id, type: 'system', title: 'Welcome to ÉLAN', body: 'Your account is ready and your welcome points are in your rewards wallet.', link: '/account/rewards', createdAt: customer.createdAt, readAt: addMinutes(customer.createdAt, 20) });
    const mine = orders.filter((o) => String(o.user) === String(customer._id) && o.status === 'delivered').sort((a, b) => b.deliveredAt - a.deliveredAt);
    for (const order of mine.slice(0, 3)) {
      const fresh = now.getTime() - order.deliveredAt.getTime() < DAY;
      push({ user: customer._id, type: 'order', title: 'Your order was delivered', body: `Order ${order.orderNumber} is with you. We hope you enjoy it.`, link: `/track-order/${order.publicId}`, createdAt: order.deliveredAt, readAt: fresh ? null : addMinutes(order.deliveredAt, 25) });
    }
    for (const order of mine.filter((o) => !reviewedOrders.has(String(o._id))).slice(0, 2)) {
      const createdAt = addMinutes(order.deliveredAt, 1);
      push({ user: customer._id, type: 'review', title: 'How was your order?', body: `Tell us about ${order.orderNumber}. Your review helps other guests choose.`, link: '/account/reviews', createdAt, readAt: null });
    }
    if (customer.profile.marketing) {
      push({ user: customer._id, type: 'promo', title: 'Free delivery from ৳1,500', body: 'Use code FREESHIP on delivery orders from ৳1,500.', link: '/menu', createdAt: addMinutes(now, -2 * 24 * 60), readAt: null });
    }
  }

  const staffPush = (n) => out.push({ _id: nextId(n.createdAt), audience: 'staff', roles: ['manager', 'owner'], email: { status: 'none' }, readBy: [], readAt: null, isDemo: true, updatedAt: n.createdAt, ...n });
  lowStock.forEach((ingredient, index) => {
    staffPush({ type: 'stock', roles: ['manager', 'owner', 'chef'], title: `Low stock: ${ingredient.name}`, body: `${ingredient.stock} ${ingredient.unit} left (alert at ${ingredient.lowStockThreshold}).`, link: '/admin/inventory', createdAt: addMinutes(now, -(6 + index * 9) * 60) });
  });
  for (const review of reviews.filter((r) => r.status === 'pending').slice(0, 2)) {
    staffPush({ type: 'review', title: 'A new review is waiting', body: `${review.rating} stars: ${review.title ?? 'untitled'}`, link: '/admin/reviews', createdAt: addMinutes(review.createdAt, 1) });
  }
  for (const reservation of reservations.filter((r) => r.status === 'confirmed' && r.startsAt > now).sort((a, b) => b.createdAt - a.createdAt).slice(0, 2)) {
    staffPush({ type: 'reservation', title: `New reservation ${reservation.code}`, body: `${reservation.date} ${reservation.seating}, ${reservation.guests} guests, ${reservation.guestName}`, link: '/admin/reservations', createdAt: addMinutes(reservation.createdAt, 1) });
  }
  return out;
}

// ------------------------------------------------------------------------------------------------ audit, contact, newsletter, cart
export function generateAudit({ now, rand, nextId, staff, partialRefund }) {
  return AUDIT.map((entry) => {
    const actor = staff[entry.by];
    const isRefund = entry.action === 'payment.refund' && partialRefund;
    const at = isRefund ? addMinutes(partialRefund.at, 6) : new Date(now.getTime() - entry.daysAgo * DAY - rand.int(1, 9) * HOUR);
    return {
      _id: nextId(at),
      actor: { id: actor._id, name: actor.name, role: actor.role },
      action: entry.action,
      entity: { type: entry.type, id: isRefund ? String(partialRefund.orderId) : undefined },
      summary: isRefund ? `Partial refund of ৳300 on order ${partialRefund.orderNumber}` : entry.summary,
      isDemo: true,
      at,
    };
  }).sort((a, b) => a.at - b.at);
}

export function generateContacts({ now, rand, nextId }) {
  return CONTACTS.map((c) => {
    const createdAt = new Date(now.getTime() - c.daysAgo * DAY - rand.int(1, 8) * HOUR);
    return { _id: nextId(createdAt), name: c.name, email: c.email, phone: c.phone || undefined, subject: c.subject, message: c.message, status: c.status, note: c.note, isDemo: true, createdAt, updatedAt: createdAt };
  });
}

export function generateSubscribers({ now, rand, nextId }) {
  const names = ['amina', 'bashir', 'chitra', 'dilruba', 'emon', 'faria', 'golam', 'hasna', 'ishrat', 'jahid', 'kabir', 'lima'];
  return names.map((name, index) => {
    const createdAt = new Date(now.getTime() - (3 + index * 3) * DAY);
    const gone = index === 4 || index === 9;
    return {
      _id: nextId(createdAt), email: `${name}@elan.demo`, status: gone ? 'unsubscribed' : 'subscribed', consent: true, consentAt: createdAt, locale: index % 4 === 3 ? 'bn' : 'en',
      unsubscribeToken: rand.code(ALNUM, 32), unsubscribedAt: gone ? new Date(createdAt.getTime() + 6 * DAY) : undefined, isDemo: true, createdAt, updatedAt: createdAt,
    };
  });
}

/** A basket Imtiaz left behind, so signing in as him shows a cart that followed him. */
export function generateCart({ customers, menu, nextId, now }) {
  const customer = customers.find((c) => c.profile.key === 'imtiaz');
  const burrata = menu.find((m) => m.slug === 'burrata-roasted-tomato');
  const ilish = menu.find((m) => m.slug === 'ilish-bhapa');
  if (!customer || !burrata || !ilish) return null;
  return {
    _id: nextId(now),
    user: customer._id,
    items: [
      { menuItem: burrata._id, quantity: 1, selections: [] },
      { menuItem: ilish._id, quantity: 1, selections: [{ group: 'spice-level', choices: ['medium'] }], note: 'Please keep it a little gentle on the chilli.' },
    ],
    createdAt: addMinutes(now, -3 * 60),
    updatedAt: addMinutes(now, -3 * 60),
  };
}
