// Guest support chat. One open conversation per signed-in guest; staff (managers and owners) answer from the admin area.
// Messages are stored first and broadcast second, so a dropped socket never loses a message.
import { Router } from 'express';
import { Conversation, Message } from '../models/index.js';
import { requireAuth, requirePermission } from '../middleware/auth.js';
import { limiter } from '../middleware/rateLimit.js';
import { objectId, validate, z } from '../middleware/validate.js';
import { notFound } from '../utils/errors.js';
import { created, ok, pageMeta, parsePagination } from '../utils/http.js';
import { EVENTS, emitToRoom, emitToRooms, rooms } from '../sockets/events.js';
import { notifyStaff, notifyUser } from '../services/notificationService.js';

export const basePath = '/chat';
const router = Router();

const text = z.string().trim().min(1, 'Write a message').max(1500);

const BOT_ACK = 'Thank you, we have your message. A member of the team will reply here as soon as they can, usually within a few minutes while we are open.';

export function serializeMessage(m) {
  const o = typeof m.toObject === 'function' ? m.toObject() : m;
  return {
    id: String(o._id),
    conversationId: String(o.conversation),
    from: o.senderRole,
    senderName: o.senderName || undefined,
    body: o.body,
    createdAt: o.createdAt,
    readAt: o.readAt || undefined,
  };
}

export function serializeConversation(c, audience = 'customer') {
  const o = typeof c.toObject === 'function' ? c.toObject() : c;
  const user = o.user && typeof o.user === 'object' && o.user.name ? { id: String(o.user._id), name: o.user.name, email: o.user.email } : undefined;
  return {
    id: String(o._id),
    status: o.status,
    subject: o.subject || undefined,
    lastMessageAt: o.lastMessageAt,
    preview: o.lastMessagePreview || undefined,
    unread: audience === 'staff' ? o.unreadForStaff ?? 0 : o.unreadForCustomer ?? 0,
    ...(audience === 'staff' ? { customer: user, assignedTo: o.assignedTo ? String(o.assignedTo) : undefined } : {}),
  };
}

const preview = (body) => body.replace(/\s+/g, ' ').slice(0, 160);

/** Stores a message, updates the conversation and broadcasts both. */
async function postMessage({ conversation, sender, senderRole, senderName, body }) {
  const message = await Message.create({ conversation: conversation._id, sender: sender?._id ?? null, senderRole, senderName, body });
  const inc = senderRole === 'customer' ? { unreadForStaff: 1 } : senderRole === 'staff' ? { unreadForCustomer: 1 } : {};
  const updated = await Conversation.findByIdAndUpdate(
    conversation._id,
    { $set: { lastMessageAt: message.createdAt ?? new Date(), lastMessagePreview: preview(body), status: 'open' }, ...(Object.keys(inc).length ? { $inc: inc } : {}) },
    { new: true },
  ).populate('user', 'name email');
  const dto = serializeMessage(message);
  emitToRooms([rooms.chat(String(conversation._id)), rooms.admin], EVENTS.CHAT_MESSAGE, dto);
  emitToRoom(rooms.admin, EVENTS.CHAT_CONVERSATION, serializeConversation(updated, 'staff'));
  return { message: dto, conversation: updated };
}

// Guest ------------------------------------------------------------------------------------------------

router.get('/', requireAuth, async (req, res) => {
  // The newest conversation, open or closed, so a guest can still read how the last one ended.
  const conversation = await Conversation.findOne({ user: req.user._id }).sort({ lastMessageAt: -1 });
  if (!conversation) return ok(res, { conversation: null, messages: [] });
  const rows = await Message.find({ conversation: conversation._id }).sort({ createdAt: -1 }).limit(100).lean();
  return ok(res, { conversation: serializeConversation(conversation), messages: rows.reverse().map(serializeMessage) });
});

router.post('/messages', requireAuth, limiter({ windowMs: 60_000, limit: 20, message: 'You are sending messages very quickly. Please slow down a little.' }), validate({ body: z.object({ body: text }) }), async (req, res) => {
  let conversation = await Conversation.findOne({ user: req.user._id, status: 'open' });
  const isNew = !conversation;
  if (!conversation) conversation = await Conversation.create({ user: req.user._id, subject: 'Chat', lastMessageAt: new Date() });
  const wasQuiet = isNew || (conversation.unreadForStaff ?? 0) === 0;

  const sent = await postMessage({ conversation, sender: req.user, senderRole: 'customer', senderName: req.user.name, body: req.valid.body.body });
  if (wasQuiet) {
    await notifyStaff({ type: 'chat', title: `New chat from ${req.user.name.split(' ')[0]}`, body: preview(req.valid.body.body).slice(0, 90), link: '/admin/messages' }, { roles: ['manager', 'owner'] });
  }
  const replies = [sent.message];
  if (isNew) {
    const ack = await postMessage({ conversation, sender: null, senderRole: 'bot', senderName: 'ÉLAN', body: BOT_ACK });
    replies.push(ack.message);
  }
  created(res, { conversationId: String(conversation._id), messages: replies });
});

router.post('/read', requireAuth, async (req, res) => {
  const open = await Conversation.find({ user: req.user._id, status: 'open' }).select('_id').lean();
  if (open.length) {
    const ids = open.map((c) => c._id);
    await Promise.all([
      Conversation.updateMany({ _id: { $in: ids } }, { $set: { unreadForCustomer: 0 } }),
      Message.updateMany({ conversation: { $in: ids }, senderRole: { $in: ['staff', 'bot'] }, readAt: null }, { $set: { readAt: new Date() } }),
    ]);
  }
  ok(res, { read: true });
});

router.get('/unread', requireAuth, async (req, res) => {
  const rows = await Conversation.find({ user: req.user._id, status: 'open' }).select('unreadForCustomer').lean();
  ok(res, { unread: rows.reduce((sum, c) => sum + (c.unreadForCustomer ?? 0), 0) });
});

// Staff ------------------------------------------------------------------------------------------------

router.get(
  '/admin/conversations',
  requirePermission('messages:read'),
  validate({ query: z.object({ status: z.enum(['open', 'closed', 'all']).default('open'), page: z.coerce.number().int().min(1).default(1), pageSize: z.coerce.number().int().min(1).max(100).default(30) }) }),
  async (req, res) => {
    const filter = req.valid.query.status === 'all' ? {} : { status: req.valid.query.status };
    const { skip, limit, page, pageSize } = parsePagination(req.valid.query, { defaultSize: 30, maxSize: 100 });
    const [rows, total, unread] = await Promise.all([
      Conversation.find(filter).sort({ lastMessageAt: -1 }).skip(skip).limit(limit).populate('user', 'name email').lean(),
      Conversation.countDocuments(filter),
      Conversation.countDocuments({ status: 'open', unreadForStaff: { $gt: 0 } }),
    ]);
    ok(res, rows.map((c) => serializeConversation(c, 'staff')), { ...pageMeta({ page, pageSize }, total), unreadConversations: unread });
  },
);

router.get('/admin/conversations/:id', requirePermission('messages:read'), validate({ params: z.object({ id: objectId }) }), async (req, res) => {
  const conversation = await Conversation.findById(req.valid.params.id).populate('user', 'name email phone');
  if (!conversation) throw notFound('Conversation not found.');
  const rows = await Message.find({ conversation: conversation._id }).sort({ createdAt: -1 }).limit(300).lean();
  await Promise.all([
    Conversation.updateOne({ _id: conversation._id }, { $set: { unreadForStaff: 0 } }),
    Message.updateMany({ conversation: conversation._id, senderRole: 'customer', readAt: null }, { $set: { readAt: new Date() } }),
  ]);
  ok(res, { conversation: { ...serializeConversation(conversation, 'staff'), unread: 0 }, messages: rows.reverse().map(serializeMessage) });
});

router.post(
  '/admin/conversations/:id/messages',
  requirePermission('messages:update'),
  limiter({ windowMs: 60_000, limit: 60 }),
  validate({ params: z.object({ id: objectId }), body: z.object({ body: text }) }),
  async (req, res) => {
    const conversation = await Conversation.findById(req.valid.params.id);
    if (!conversation) throw notFound('Conversation not found.');
    const sent = await postMessage({ conversation, sender: req.user, senderRole: 'staff', senderName: req.user.name.split(' ')[0], body: req.valid.body.body });
    await notifyUser(conversation.user, { type: 'chat', title: 'ÉLAN replied to your message', body: preview(req.valid.body.body).slice(0, 90), link: '/account/support' });
    created(res, sent.message);
  },
);

router.patch('/admin/conversations/:id', requirePermission('messages:update'), validate({ params: z.object({ id: objectId }), body: z.object({ status: z.enum(['open', 'closed']) }) }), async (req, res) => {
  const conversation = await Conversation.findByIdAndUpdate(req.valid.params.id, { $set: { status: req.valid.body.status } }, { new: true }).populate('user', 'name email');
  if (!conversation) throw notFound('Conversation not found.');
  emitToRoom(rooms.admin, EVENTS.CHAT_CONVERSATION, serializeConversation(conversation, 'staff'));
  ok(res, serializeConversation(conversation, 'staff'));
});

export default router;
