// Emit helpers used by services. They are safe no-ops when sockets are not initialised (tests, seed scripts).
// MongoDB stays the source of truth: sockets only notify, they never carry the only copy of anything.
let io = null;

export function setIo(instance) {
  io = instance;
}

export function getIo() {
  return io;
}

export function emitToRoom(room, event, payload) {
  if (!io) return;
  io.to(room).emit(event, payload);
}

/** Emits once to several rooms; a socket that sits in more than one of them still receives the event a single time. */
export function emitToRooms(roomList, event, payload) {
  if (!io || roomList.length === 0) return;
  io.to(roomList).emit(event, payload);
}

export const rooms = {
  user: (id) => `user:${id}`,
  order: (publicId) => `order:${publicId}`,
  chat: (conversationId) => `chat:${conversationId}`,
  staff: 'staff', // chef, manager, owner
  kitchen: 'kitchen', // chef, manager, owner
  admin: 'admin', // manager, owner
  delivery: 'delivery', // delivery staff (+ manager, owner)
};

/**
 * Realtime event catalogue (server -> client):
 *   order:new            -> kitchen, admin     (staff order payload)
 *   order:update         -> order:<publicId>, user:<id>, kitchen, admin, delivery   (public payload for guests, staff payload for staff rooms)
 *   reservation:new      -> admin
 *   reservation:update   -> admin, user:<id>
 *   notification:new     -> user:<id> or staff
 *   chat:message         -> chat:<conversationId>, admin
 *   chat:conversation    -> admin             (new / updated conversation summary)
 *   stock:low            -> admin
 * Client -> server: order:watch {publicId}, order:unwatch {publicId}, chat:join {conversationId}, chat:typing {conversationId}
 */
export const EVENTS = Object.freeze({
  ORDER_NEW: 'order:new',
  ORDER_UPDATE: 'order:update',
  RESERVATION_NEW: 'reservation:new',
  RESERVATION_UPDATE: 'reservation:update',
  NOTIFICATION_NEW: 'notification:new',
  CHAT_MESSAGE: 'chat:message',
  CHAT_CONVERSATION: 'chat:conversation',
  STOCK_LOW: 'stock:low',
});
