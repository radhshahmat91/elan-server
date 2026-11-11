// Socket.IO server. Connections may be anonymous (guests tracking an order by its unguessable id) or
// authenticated with a short-lived signed token from GET /api/auth/socket-token. Every room join is
// authorised here on the server.
import { Server } from 'socket.io';
import { env } from '../config/env.js';
import { verifyToken } from '../utils/crypto.js';
import { Conversation, Order } from '../models/index.js';
import { rooms, setIo } from './events.js';
import { logger } from '../utils/logger.js';

const MAX_WATCHED_ORDERS = 10;
const isId = (value) => typeof value === 'string' && /^[a-z0-9]{8,32}$/i.test(value);

export function initSockets(httpServer) {
  const io = new Server(httpServer, {
    cors: { origin: env.allowedOrigins, credentials: true },
    pingInterval: 25_000,
    pingTimeout: 20_000,
    maxHttpBufferSize: 100_000,
  });

  io.use((socket, next) => {
    const token = socket.handshake.auth?.token;
    if (!token) {
      socket.data.user = null; // guest
      return next();
    }
    const payload = verifyToken(token, env.SOCKET_TOKEN_SECRET);
    if (!payload || payload.typ !== 'socket' || !payload.sub) return next(new Error('unauthorized'));
    socket.data.user = { id: String(payload.sub), role: payload.role, name: payload.name };
    return next();
  });

  io.on('connection', (socket) => {
    const user = socket.data.user;
    socket.data.watched = new Set();

    if (user) {
      socket.join(rooms.user(user.id));
      if (['chef', 'manager', 'owner'].includes(user.role)) {
        socket.join(rooms.staff);
        socket.join(rooms.kitchen);
      }
      if (['manager', 'owner'].includes(user.role)) socket.join(rooms.admin);
      if (['delivery', 'manager', 'owner'].includes(user.role)) socket.join(rooms.delivery);
    }

    // Guests and customers follow one order. The public id acts as the capability.
    socket.on('order:watch', async (payload, ack) => {
      try {
        const publicId = payload?.publicId;
        if (!isId(publicId)) return ack?.({ ok: false });
        if (socket.data.watched.size >= MAX_WATCHED_ORDERS) return ack?.({ ok: false });
        const exists = await Order.exists({ publicId });
        if (!exists) return ack?.({ ok: false });
        socket.join(rooms.order(publicId));
        socket.data.watched.add(publicId);
        return ack?.({ ok: true });
      } catch (err) {
        logger.warn('order:watch failed', { message: err.message });
        return ack?.({ ok: false });
      }
    });

    socket.on('order:unwatch', (payload) => {
      const publicId = payload?.publicId;
      if (!isId(publicId)) return;
      socket.leave(rooms.order(publicId));
      socket.data.watched.delete(publicId);
    });

    // Support chat: customers join their own conversation, managers/owners join any.
    socket.on('chat:join', async (payload, ack) => {
      try {
        if (!user || !isId(payload?.conversationId)) return ack?.({ ok: false });
        const conversation = await Conversation.findById(payload.conversationId).select('user').lean();
        if (!conversation) return ack?.({ ok: false });
        const isOwner = String(conversation.user) === user.id;
        const isSupport = ['manager', 'owner'].includes(user.role);
        if (!isOwner && !isSupport) return ack?.({ ok: false });
        socket.join(rooms.chat(payload.conversationId));
        return ack?.({ ok: true });
      } catch {
        return ack?.({ ok: false });
      }
    });

    socket.on('chat:typing', (payload) => {
      if (!user || !isId(payload?.conversationId)) return;
      const room = rooms.chat(payload.conversationId);
      if (!socket.rooms.has(room)) return; // only people who joined may relay typing
      socket.to(room).emit('chat:typing', { conversationId: payload.conversationId, role: user.role });
    });
  });

  setIo(io);
  return io;
}
