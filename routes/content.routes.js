// Editable site content. Today that is the FAQ: the approved answers the website and the Concierge are allowed to give.
import { Router } from 'express';
import { Faq } from '../models/index.js';
import { requirePermission } from '../middleware/auth.js';
import { objectId, validate, z } from '../middleware/validate.js';
import { notFound } from '../utils/errors.js';
import { created, ok } from '../utils/http.js';
import { audit } from '../services/auditService.js';

export const basePath = '/admin/content';
const router = Router();

const opt = (schema) => z.union([schema, z.literal('').transform(() => undefined)]).optional();
const keywords = z.array(z.string().trim().toLowerCase().min(2).max(40)).max(12);

export function serializeFaq(f) {
  const o = typeof f.toObject === 'function' ? f.toObject() : f;
  return {
    id: String(o._id),
    category: o.category,
    question: o.question,
    questionBn: o.questionBn || undefined,
    answer: o.answer,
    answerBn: o.answerBn || undefined,
    keywords: o.keywords ?? [],
    keywordsBn: o.keywordsBn ?? [],
    sortOrder: o.sortOrder ?? 0,
    active: o.active !== false,
  };
}

const shape = z.object({
  category: z.string().trim().min(2).max(30),
  question: z.string().trim().min(5, 'Write the question').max(200),
  questionBn: opt(z.string().trim().max(260)),
  answer: z.string().trim().min(5, 'Write the answer').max(800),
  answerBn: opt(z.string().trim().max(1000)),
  keywords,
  keywordsBn: keywords,
  sortOrder: z.number().int().min(0).max(10_000),
  active: z.boolean(),
});

router.get('/faqs', requirePermission('content:read'), async (_req, res) => {
  const rows = await Faq.find({}).sort({ category: 1, sortOrder: 1, createdAt: 1 }).lean();
  ok(res, rows.map(serializeFaq));
});

router.post('/faqs', requirePermission('content:create'), validate({ body: shape.partial({ category: true, questionBn: true, answerBn: true, keywords: true, keywordsBn: true, sortOrder: true, active: true }) }), async (req, res) => {
  const doc = await Faq.create({ category: 'general', ...req.valid.body });
  await audit(req, 'faq.create', { type: 'faq', id: doc._id }, `Added FAQ: ${doc.question}`);
  created(res, serializeFaq(doc));
});

router.put('/faqs/:id', requirePermission('content:update'), validate({ params: z.object({ id: objectId }), body: shape.partial() }), async (req, res) => {
  const doc = await Faq.findByIdAndUpdate(req.valid.params.id, { $set: req.valid.body }, { new: true }).lean();
  if (!doc) throw notFound('FAQ not found.');
  await audit(req, 'faq.update', { type: 'faq', id: doc._id }, `Updated FAQ: ${doc.question}`, { fields: Object.keys(req.valid.body) });
  ok(res, serializeFaq(doc));
});

router.delete('/faqs/:id', requirePermission('content:delete'), validate({ params: z.object({ id: objectId }) }), async (req, res) => {
  const doc = await Faq.findByIdAndDelete(req.valid.params.id);
  if (!doc) throw notFound('FAQ not found.');
  await audit(req, 'faq.delete', { type: 'faq', id: doc._id }, `Deleted FAQ: ${doc.question}`);
  ok(res, { deleted: true });
});

export default router;
