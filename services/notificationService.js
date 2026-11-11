// In-app notifications (stored, then pushed over sockets) and email (queued; logged when SMTP is not configured).
import { Notification, User } from '../models/index.js';
import { EVENTS, emitToRoom, emitToRooms, rooms } from '../sockets/events.js';
import { enqueue } from '../jobs/queue.js';
import { logger } from '../utils/logger.js';

export function serializeNotification(n) {
  return {
    id: String(n._id),
    type: n.type,
    title: n.title,
    body: n.body || undefined,
    link: n.link || undefined,
    read: Boolean(n.readAt),
    createdAt: n.createdAt,
  };
}

/**
 * Creates an in-app notification for one user, pushes it to room user:<id>, and queues an email when `email` is given.
 * A guest who switched off the matching preference gets nothing. Returns the document or null.
 * payload: { type, title, body?, link?, data?, email?: { subject, html, text? }, prefKey?: 'orderUpdates'|'reservationUpdates'|'promotions' }
 */
export async function notifyUser(userId, payload) {
  const user = await User.findById(userId).select('email notificationPrefs status').lean();
  if (!user || user.status !== 'active') return null;
  if (payload.prefKey && user.notificationPrefs?.[payload.prefKey] === false) return null;
  const wantsEmail = Boolean(payload.email && user.email);
  const doc = await Notification.create({
    user: userId,
    audience: 'user',
    type: payload.type,
    title: payload.title,
    body: payload.body,
    link: payload.link,
    data: payload.data,
    email: { status: wantsEmail ? 'queued' : 'none' },
  });
  emitToRoom(rooms.user(String(userId)), EVENTS.NOTIFICATION_NEW, serializeNotification(doc));
  if (wantsEmail) enqueue('email', { to: user.email, ...payload.email, notificationId: String(doc._id) });
  return doc;
}

const ROLE_ROOM = { owner: rooms.admin, manager: rooms.admin, chef: rooms.kitchen, delivery: rooms.delivery };

/** Staff-audience notification, pushed to the rooms of the roles that should see it (default managers and owners). */
export async function notifyStaff(payload, { roles = ['manager', 'owner'] } = {}) {
  const doc = await Notification.create({
    audience: 'staff',
    roles,
    type: payload.type,
    title: payload.title,
    body: payload.body,
    link: payload.link,
    data: payload.data,
  });
  const targets = [...new Set(roles.map((r) => ROLE_ROOM[r]).filter(Boolean))];
  emitToRooms(targets, EVENTS.NOTIFICATION_NEW, serializeNotification(doc));
  return doc;
}

/** Queues an email. Without SMTP the job handler logs a one-line summary instead of sending. */
export async function sendEmail(message) {
  if (!message?.to) return;
  enqueue('email', message);
  logger.debug('email queued', { subject: message.subject });
}
