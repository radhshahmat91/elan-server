import { Router } from 'express';
import { ContactMessage } from '../models/index.js';
import { CONTACT_STATUSES } from '../models/constants.js';
import { requirePermission } from '../middleware/auth.js';
import { limiter } from '../middleware/rateLimit.js';
import { email, objectId, phone, validate, z } from '../middleware/validate.js';
import { emailLayout, escapeHtml } from '../utils/emailLayout.js';
import { notFound } from '../utils/errors.js';
import { firstName } from '../utils/format.js';
import { containsRegex, ok, pageMeta, parsePagination } from '../utils/http.js';
import { audit } from '../services/auditService.js';
import { notifyStaff, sendEmail } from '../services/notificationService.js';

export const basePath = '/contact';
const router = Router();

const opt = (schema) => z.union([schema, z.literal('').transform(() => undefined)]).optional();

export function serializeContactMessage(m) {
  const o = typeof m.toObject === 'function' ? m.toObject() : m;
  return { id: String(o._id), name: o.name, email: o.email, phone: o.phone || undefined, subject: o.subject || undefined, message: o.message, status: o.status, note: o.note || undefined, createdAt: o.createdAt };
}

const body = z.object({
  name: z.string().trim().min(2, 'Enter your name').max(80),
  email,
  phone: opt(phone),
  subject: opt(z.string().trim().max(120)),
  message: z.string().trim().min(10, 'Write a few words so we can help (at least 10 characters)').max(2000),
  website: z.string().max(200).optional(), // honeypot: real visitors never see this field
});

router.post('/', limiter({ windowMs: 15 * 60_000, limit: 5, message: 'You have sent a few messages already. Please wait a little, or call us.' }), validate({ body }), async (req, res) => {
  const { website, ...input } = req.valid.body;
  if (website) return ok(res, { sent: true }); // a bot filled the hidden field: pretend it worked, store nothing
  const doc = await ContactMessage.create(input);
  await notifyStaff({ type: 'system', title: 'New message from the contact form', body: `${input.name}: ${input.message.slice(0, 80)}`, link: '/admin/messages' }, { roles: ['manager', 'owner'] });
  await sendEmail({
    to: input.email,
    subject: 'We received your message',
    html: emailLayout({
      title: 'Thank you for writing',
      preheader: 'We will reply as soon as we can.',
      bodyHtml: `<p style="margin:0 0 12px">Hello ${escapeHtml(firstName(input.name))}, your message has reached the team. We usually reply within one working day.</p><p style="margin:0;color:#bba99a;font-size:13px">If it is urgent, please call us instead.</p>`,
    }),
    text: `Hello ${firstName(input.name)}, we received your message and will reply within one working day.`,
  });
  return ok(res, { sent: true, id: String(doc._id) });
});

// Staff -----------------------------------------------------------------------------------------------

router.get(
  '/admin',
  requirePermission('messages:read'),
  validate({ query: z.object({ status: z.enum(CONTACT_STATUSES).optional(), q: z.string().trim().max(80).optional(), page: z.coerce.number().int().min(1).default(1), pageSize: z.coerce.number().int().min(1).max(100).default(20) }) }),
  async (req, res) => {
    const { status, q } = req.valid.query;
    const filter = {};
    if (status) filter.status = status;
    if (q) {
      const re = containsRegex(q);
      filter.$or = [{ name: re }, { email: re }, { subject: re }, { message: re }];
    }
    const { skip, limit, page, pageSize } = parsePagination(req.valid.query, { defaultSize: 20, maxSize: 100 });
    const [rows, total, counts] = await Promise.all([
      ContactMessage.find(filter).sort({ createdAt: -1 }).skip(skip).limit(limit).lean(),
      ContactMessage.countDocuments(filter),
      ContactMessage.aggregate([{ $group: { _id: '$status', n: { $sum: 1 } } }]),
    ]);
    ok(res, rows.map(serializeContactMessage), { ...pageMeta({ page, pageSize }, total), counts: Object.fromEntries(counts.map((c) => [c._id, c.n])) });
  },
);

router.patch(
  '/admin/:id',
  requirePermission('messages:update'),
  validate({ params: z.object({ id: objectId }), body: z.object({ status: z.enum(CONTACT_STATUSES), note: z.string().trim().max(400).optional() }).partial() }),
  async (req, res) => {
    const doc = await ContactMessage.findByIdAndUpdate(req.valid.params.id, { $set: req.valid.body }, { new: true }).lean();
    if (!doc) throw notFound('Message not found.');
    await audit(req, 'message.update', { type: 'contactMessage', id: doc._id }, `Marked a message ${doc.status}`);
    ok(res, serializeContactMessage(doc));
  },
);

router.delete('/admin/:id', requirePermission('messages:delete'), validate({ params: z.object({ id: objectId }) }), async (req, res) => {
  const doc = await ContactMessage.findByIdAndDelete(req.valid.params.id);
  if (!doc) throw notFound('Message not found.');
  await audit(req, 'message.delete', { type: 'contactMessage', id: doc._id }, 'Deleted a contact message');
  ok(res, { deleted: true });
});

export default router;
