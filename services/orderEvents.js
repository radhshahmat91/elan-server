// Realtime fan-out and customer/staff notifications for orders. Kept separate from orderService and
// paymentService so both can use it without importing each other.
import { EVENTS, emitToRoom, emitToRooms, rooms } from '../sockets/events.js';
import { serializeOrder } from '../serializers/order.js';
import { notifyStaff, notifyUser, sendEmail } from './notificationService.js';
import { buildOrderEmail } from './orderEmails.js';
import { logger } from '../utils/logger.js';
import { bdt } from '../utils/format.js';

/** A fresh order reaches the kitchen board and the admin order list. */
export function emitOrderNew(order) {
  emitToRooms([rooms.kitchen], EVENTS.ORDER_NEW, serializeOrder(order, 'staff'));
}

/** One persisted change, three payloads: staff rooms, the owner's room, and the tracking page. */
export function emitOrderUpdate(order) {
  emitToRooms([rooms.kitchen, rooms.delivery], EVENTS.ORDER_UPDATE, serializeOrder(order, 'staff'));
  emitToRoom(rooms.order(order.publicId), EVENTS.ORDER_UPDATE, serializeOrder(order, 'public'));
  if (order.user) emitToRoom(rooms.user(String(order.user)), EVENTS.ORDER_UPDATE, serializeOrder(order, 'owner'));
}

/** In-app notification plus email to whoever placed the order. Failures are logged, never thrown. */
export async function notifyCustomer(order, status) {
  try {
    const mail = buildOrderEmail(order, status);
    if (!mail) return;
    if (order.user) {
      await notifyUser(order.user, {
        type: 'order',
        title: mail.title,
        body: `${order.orderNumber}: ${mail.line}`,
        link: `/track-order/${order.publicId}`,
        prefKey: 'orderUpdates',
        email: { subject: mail.subject, html: mail.html, text: mail.text },
      });
    } else if (order.customer?.email) {
      await sendEmail({ to: order.customer.email, subject: mail.subject, html: mail.html, text: mail.text });
    }
  } catch (err) {
    logger.warn('customer notification failed', { order: order.orderNumber, message: err.message });
  }
}

/** Everything that happens the moment an order is actually placed (COD at once, online after payment is verified). */
export async function announcePlaced(order) {
  try {
    emitOrderNew(order);
    emitOrderUpdate(order);
    await notifyStaff(
      {
        type: 'order',
        title: `New order ${order.orderNumber}`,
        body: `${order.items.length} ${order.items.length === 1 ? 'line' : 'lines'}, ${bdt(order.totals.total)}, ${order.fulfillment.replace('_', '-')}`,
        link: '/kitchen',
        data: { orderId: String(order._id) },
      },
      { roles: ['chef', 'manager', 'owner'] },
    );
    await notifyCustomer(order, 'placed');
  } catch (err) {
    logger.warn('announcePlaced failed', { order: order.orderNumber, message: err.message });
  }
}
