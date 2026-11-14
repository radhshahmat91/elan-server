// The public gallery and its admin. A tile is either an uploaded photograph (url) or generative art the website draws itself.
import { Router } from 'express';
import { GalleryItem } from '../models/index.js';
import { ART_MOTIFS, GALLERY_CATEGORIES } from '../models/constants.js';
import { requirePermission } from '../middleware/auth.js';
import { objectId, validate, z } from '../middleware/validate.js';
import { notFound } from '../utils/errors.js';
import { created, ok } from '../utils/http.js';
import { audit } from '../services/auditService.js';
import { galleryUpdateFor } from '../utils/gallery.js';

export const basePath = '/gallery';
const router = Router();

const opt = (schema) => z.union([schema, z.literal('').transform(() => undefined)]).optional();

const artOf = (g) => (g.art && (g.art.scene || g.art.motif) ? { scene: g.art.scene || undefined, motif: g.art.motif || undefined, palette: g.art.palette?.length ? g.art.palette : undefined, seed: g.art.seed ?? undefined } : undefined);

export function serializeGalleryItem(g, { admin = false } = {}) {
  const o = typeof g.toObject === 'function' ? g.toObject() : g;
  return {
    id: String(o._id),
    title: o.title,
    alt: o.alt,
    category: o.category,
    url: o.url || undefined,
    art: artOf(o),
    ...(admin ? { publicId: o.publicId || undefined, sortOrder: o.sortOrder ?? 0, active: o.active !== false } : {}),
  };
}

router.get('/', validate({ query: z.object({ category: z.enum(GALLERY_CATEGORIES).optional() }) }), async (req, res) => {
  const filter = { active: true, ...(req.valid.query.category ? { category: req.valid.query.category } : {}) };
  const rows = await GalleryItem.find(filter).sort({ sortOrder: 1, createdAt: 1 }).limit(120).lean();
  ok(res, rows.map((g) => serializeGalleryItem(g)));
});

// Admin ----------------------------------------------------------------------------------------------

// Photographs live on Cloudinary (https) or in this server's own uploads folder.
const imageUrl = z.string().trim().max(500).regex(/^(https:\/\/|\/uploads\/)/, 'Use an uploaded image or an https link');

const shape = z.object({
  title: z.string().trim().min(2, 'Enter a title').max(80),
  alt: z.string().trim().min(4, 'Describe the picture for people who cannot see it').max(200),
  category: z.enum(GALLERY_CATEGORIES),
  url: opt(imageUrl),
  publicId: opt(z.string().trim().max(200)),
  art: z.object({ scene: z.string().trim().max(40).optional(), motif: z.enum(ART_MOTIFS).optional(), palette: z.array(z.string().regex(/^#[0-9a-fA-F]{6}$/)).max(6).optional(), seed: z.number().int().min(0).max(1_000_000).optional() }).optional(),
  sortOrder: z.number().int().min(0).max(10_000),
  active: z.boolean(),
});

const needsPicture = (v) => v.url || v.art?.scene || v.art?.motif;

router.get('/admin', requirePermission('content:read'), async (_req, res) => {
  const rows = await GalleryItem.find({}).sort({ sortOrder: 1, createdAt: 1 }).lean();
  ok(res, rows.map((g) => serializeGalleryItem(g, { admin: true })));
});

router.post(
  '/admin',
  requirePermission('content:create'),
  validate({ body: shape.partial({ url: true, publicId: true, art: true, sortOrder: true, active: true }).refine(needsPicture, { message: 'Add a photograph or choose a generated picture', path: ['url'] }) }),
  async (req, res) => {
    const last = await GalleryItem.findOne({}).sort({ sortOrder: -1 }).select('sortOrder').lean();
    const doc = await GalleryItem.create({ sortOrder: (last?.sortOrder ?? 0) + 1, ...req.valid.body });
    await audit(req, 'gallery.create', { type: 'gallery', id: doc._id }, `Added gallery picture ${doc.title}`);
    created(res, serializeGalleryItem(doc, { admin: true }));
  },
);

router.put('/admin/:id', requirePermission('content:update'), validate({ params: z.object({ id: objectId }), body: shape.partial() }), async (req, res) => {
  const doc = await GalleryItem.findByIdAndUpdate(req.valid.params.id, galleryUpdateFor(req.valid.body), { new: true }).lean();
  if (!doc) throw notFound('Picture not found.');
  await audit(req, 'gallery.update', { type: 'gallery', id: doc._id }, `Updated gallery picture ${doc.title}`, { fields: Object.keys(req.valid.body) });
  ok(res, serializeGalleryItem(doc, { admin: true }));
});

router.post('/admin/reorder', requirePermission('content:update'), validate({ body: z.object({ ids: z.array(objectId).min(1).max(200) }) }), async (req, res) => {
  const { ids } = req.valid.body;
  await GalleryItem.bulkWrite(ids.map((id, index) => ({ updateOne: { filter: { _id: id }, update: { $set: { sortOrder: index + 1 } } } })));
  await audit(req, 'gallery.reorder', { type: 'gallery' }, `Reordered ${ids.length} gallery pictures`);
  ok(res, { saved: true });
});

router.delete('/admin/:id', requirePermission('content:delete'), validate({ params: z.object({ id: objectId }) }), async (req, res) => {
  const doc = await GalleryItem.findByIdAndDelete(req.valid.params.id);
  if (!doc) throw notFound('Picture not found.');
  await audit(req, 'gallery.delete', { type: 'gallery', id: doc._id }, `Deleted gallery picture ${doc.title}`);
  ok(res, { deleted: true });
});

export default router;
