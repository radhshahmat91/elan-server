import { Router } from 'express';
import { Subscriber } from '../models/index.js';
import { requirePermission } from '../middleware/auth.js';
import { limiter } from '../middleware/rateLimit.js';
import { email, validate, z } from '../middleware/validate.js';
import { env } from '../config/env.js';
import { randomToken } from '../utils/crypto.js';
import { emailLayout, escapeHtml } from '../utils/emailLayout.js';
import { csvCell } from '../utils/format.js';
import { ok, pageMeta, parsePagination } from '../utils/http.js';
import { sendEmail } from '../services/notificationService.js';

export const basePath = '/newsletter';
const router = Router();

const unsubscribeUrl = (token) => `${env.PUBLIC_CLIENT_URL}/unsubscribe?token=${encodeURIComponent(token)}`;

// Public ----------------------------------------------------------------------------------------------

// Whether or not the address was already on the list, the answer is the same: it never reveals who is subscribed.
router.post('/', limiter({ windowMs: 10 * 60_000, limit: 6, message: 'Too many sign-ups from this connection. Please try again later.' }), validate({ body: z.object({ email, locale: z.enum(['en', 'bn']).default('en') }) }), async (req, res) => {
  const { email: address, locale } = req.valid.body;
  const existing = await Subscriber.findOne({ email: address });
  if (existing?.status === 'subscribed') return ok(res, { subscribed: true });

  let subscriber;
  try {
    subscriber = existing
      ? await Subscriber.findOneAndUpdate({ _id: existing._id }, { $set: { status: 'subscribed', consent: true, consentAt: new Date(), locale }, $unset: { unsubscribedAt: '' } }, { new: true })
      : await Subscriber.create({ email: address, consent: true, locale, unsubscribeToken: randomToken(24) });
  } catch (err) {
    if (err?.code === 11000) return ok(res, { subscribed: true }); // two sign-ups raced: either way they are subscribed
    throw err;
  }

  await sendEmail({
    to: address,
    subject: 'Welcome to ÉLAN',
    html: emailLayout({
      title: 'You are on the list',
      preheader: 'News from the kitchen, now and then.',
      bodyHtml: '<p style="margin:0 0 12px">Thank you for joining. We write only when there is something worth saying: a new dish, a seasonal menu, a table that has opened up.</p><p style="margin:0;color:#bba99a;font-size:13px">You can leave the list at any time with the link at the bottom of every email.</p>',
      cta: { label: 'See the menu', url: `${env.PUBLIC_CLIENT_URL}/menu` },
      footerHtml: `<a href="${escapeHtml(unsubscribeUrl(subscriber.unsubscribeToken))}" style="color:#bba99a">Unsubscribe</a>`,
    }),
    text: `Thank you for joining the ÉLAN list. Unsubscribe any time: ${unsubscribeUrl(subscriber.unsubscribeToken)}`,
  });
  return ok(res, { subscribed: true });
});

router.post('/unsubscribe', limiter({ windowMs: 10 * 60_000, limit: 20 }), validate({ body: z.object({ token: z.string().trim().min(10).max(80) }) }), async (req, res) => {
  const row = await Subscriber.findOneAndUpdate({ unsubscribeToken: req.valid.body.token }, { $set: { status: 'unsubscribed', unsubscribedAt: new Date() } });
  // An unknown token gets the same answer, so the endpoint cannot be used to test tokens.
  ok(res, { unsubscribed: true, wasSubscribed: Boolean(row && row.status === 'subscribed') });
});

// Staff -----------------------------------------------------------------------------------------------

router.get(
  '/admin',
  requirePermission('content:read'),
  validate({ query: z.object({ status: z.enum(['subscribed', 'unsubscribed']).optional(), page: z.coerce.number().int().min(1).default(1), pageSize: z.coerce.number().int().min(1).max(100).default(30) }) }),
  async (req, res) => {
    const filter = req.valid.query.status ? { status: req.valid.query.status } : {};
    const { skip, limit, page, pageSize } = parsePagination(req.valid.query, { defaultSize: 30, maxSize: 100 });
    const [rows, total, subscribed] = await Promise.all([Subscriber.find(filter).sort({ createdAt: -1 }).skip(skip).limit(limit).lean(), Subscriber.countDocuments(filter), Subscriber.countDocuments({ status: 'subscribed' })]);
    ok(res, rows.map((s) => ({ id: String(s._id), email: s.email, status: s.status, locale: s.locale, subscribedAt: s.consentAt, unsubscribedAt: s.unsubscribedAt || undefined })), { ...pageMeta({ page, pageSize }, total), subscribed });
  },
);

router.get('/admin/export.csv', requirePermission('content:read'), async (_req, res) => {
  const rows = await Subscriber.find({ status: 'subscribed' }).sort({ createdAt: 1 }).limit(50_000).lean();
  const body = ['Email,Language,Consent given', ...rows.map((s) => [s.email, s.locale, s.consentAt ? new Date(s.consentAt).toISOString() : ''].map(csvCell).join(','))].join('\r\n');
  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', 'attachment; filename="elan-subscribers.csv"');
  res.setHeader('Cache-Control', 'private, no-store');
  res.send(`﻿${body}\r\n`);
});

export default router;
