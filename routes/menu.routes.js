import { Router } from 'express';
import { Category, Coupon, MenuItem, User } from '../models/index.js';
import { validate, z } from '../middleware/validate.js';
import { containsRegex, ok, pageMeta, parsePagination } from '../utils/http.js';
import { notFound } from '../utils/errors.js';
import { serializeCategory, serializeMenuItem, serializeOffer } from '../serializers/menu.js';

export const basePath = '/menu';
const router = Router();

const LIST_POPULATE = [
  { path: 'optionGroups', select: 'key isRequired minSelect active' },
  { path: 'category', select: 'name slug' },
];

const SORTS = {
  recommended: { featured: -1, sortOrder: 1, name: 1 },
  popular: { soldCount: -1, featured: -1, name: 1 },
  price_asc: { price: 1, name: 1 },
  price_desc: { price: -1, name: 1 },
  rating: { 'rating.avg': -1, 'rating.count': -1, name: 1 },
  new: { createdAt: -1 },
};

router.get('/categories', async (_req, res) => {
  const [categories, counts, arts] = await Promise.all([
    Category.find({ active: true, parent: null }).sort({ sortOrder: 1, name: 1 }).lean(),
    MenuItem.aggregate([{ $match: { archived: false } }, { $group: { _id: '$category', n: { $sum: 1 } } }]),
    MenuItem.aggregate([
      { $match: { archived: false, 'art.motif': { $exists: true, $ne: null } } },
      { $sort: { featured: -1, soldCount: -1 } },
      { $group: { _id: '$category', art: { $first: '$art' } } },
    ]),
  ]);
  const countOf = new Map(counts.map((c) => [String(c._id), c.n]));
  const artOf = new Map(arts.map((a) => [String(a._id), { motif: a.art.motif, palette: a.art.palette }]));
  ok(res, categories.map((c) => serializeCategory(c, countOf.get(String(c._id)) ?? 0, artOf.get(String(c._id)))));
});

const listQuery = z.object({
  category: z.string().trim().max(60).optional(),
  q: z.string().trim().max(80).optional(),
  tag: z.string().trim().max(200).optional(),
  maxPrice: z.coerce.number().int().min(0).max(1_000_000).optional(),
  sort: z.enum(Object.keys(SORTS)).default('recommended'),
  availableOnly: z.enum(['true', 'false']).optional(),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(24),
});

router.get('/items', validate({ query: listQuery }), async (req, res) => {
  const q = req.valid.query;
  const filter = { archived: false };
  if (q.category) {
    const category = await Category.findOne({ slug: q.category.toLowerCase(), active: true }).select('_id').lean();
    if (!category) return ok(res, [], pageMeta({ page: 1, pageSize: q.pageSize }, 0));
    filter.category = category._id;
  }
  if (q.q) {
    const re = containsRegex(q.q);
    filter.$or = [{ name: re }, { description: re }, { ingredients: re }];
  }
  if (q.tag) filter.tags = { $all: q.tag.split(',').map((t) => t.trim()).filter(Boolean) };
  if (q.maxPrice != null) filter.price = { $lte: q.maxPrice };
  if (q.availableOnly === 'true') filter.available = true;

  const { skip, limit, page, pageSize } = parsePagination(req.valid.query, { defaultSize: 24, maxSize: 100 });
  const [rows, total] = await Promise.all([
    MenuItem.find(filter).sort(SORTS[q.sort]).skip(skip).limit(limit).populate(LIST_POPULATE).lean(),
    MenuItem.countDocuments(filter),
  ]);
  ok(res, rows.map((r) => serializeMenuItem(r)), pageMeta({ page, pageSize }, total));
});

router.get('/items/featured', async (_req, res) => {
  const base = { archived: false, available: true };
  let rows = await MenuItem.find({ ...base, featured: true }).sort({ soldCount: -1, sortOrder: 1 }).limit(8).populate(LIST_POPULATE).lean();
  if (rows.length < 4) {
    const have = rows.map((r) => r._id);
    const extra = await MenuItem.find({ ...base, _id: { $nin: have } }).sort({ soldCount: -1 }).limit(8 - rows.length).populate(LIST_POPULATE).lean();
    rows = [...rows, ...extra];
  }
  ok(res, rows.map((r) => serializeMenuItem(r)));
});

router.get('/items/:slug', async (req, res) => {
  const item = await MenuItem.findOne({ slug: String(req.params.slug).toLowerCase(), archived: false })
    .populate('optionGroups')
    .populate('category', 'name slug')
    .lean();
  if (!item) throw notFound('That dish is not on the menu.');

  const related = await MenuItem.find({ category: item.category?._id, _id: { $ne: item._id }, archived: false })
    .sort({ featured: -1, soldCount: -1 })
    .limit(4)
    .populate(LIST_POPULATE)
    .lean();

  // Counters are best effort and never block the response.
  MenuItem.updateOne({ _id: item._id }, { $inc: { viewCount: 1 } }).catch(() => {});
  if (req.user) {
    User.updateOne({ _id: req.user._id }, { $pull: { recentlyViewed: item._id } })
      .then(() => User.updateOne({ _id: req.user._id }, { $push: { recentlyViewed: { $each: [item._id], $position: 0, $slice: 12 } } }))
      .catch(() => {});
  }
  ok(res, { ...serializeMenuItem(item, { detail: true }), related: related.map((r) => serializeMenuItem(r)) });
});

router.get('/offers', async (_req, res) => {
  const now = new Date();
  const rows = await Coupon.find({
    active: true,
    showOnSite: true,
    $and: [{ $or: [{ expiresAt: null }, { expiresAt: { $gt: now } }] }, { $or: [{ startsAt: null }, { startsAt: { $lte: now } }] }],
  })
    .sort({ createdAt: -1 })
    .limit(6)
    .lean();
  ok(res, rows.filter((c) => c.usageLimit == null || c.usedCount < c.usageLimit).map(serializeOffer));
});

router.get('/search-suggest', validate({ query: z.object({ q: z.string().trim().min(1).max(60) }) }), async (req, res) => {
  const re = containsRegex(req.valid.query.q);
  const rows = await MenuItem.find({ archived: false, $or: [{ name: re }] })
    .sort({ soldCount: -1 })
    .limit(6)
    .select('name slug price salePrice art')
    .lean();
  ok(res, rows.map((r) => ({ name: r.name, slug: r.slug, price: r.salePrice ?? r.price, art: r.art?.motif ? { motif: r.art.motif, palette: r.art.palette } : undefined })));
});

export default router;
