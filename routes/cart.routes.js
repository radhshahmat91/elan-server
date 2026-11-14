import { Router } from 'express';
import { Cart, MenuItem } from '../models/index.js';
import { FULFILLMENT } from '../models/constants.js';
import { requireAuth } from '../middleware/auth.js';
import { limiter } from '../middleware/rateLimit.js';
import { objectId, validate, z } from '../middleware/validate.js';
import { ok } from '../utils/http.js';
import { buildQuote, priceLine } from '../services/pricingService.js';

export const basePath = '/cart';
const router = Router();

const selection = z.object({ group: z.string().trim().max(60), choices: z.array(z.string().trim().max(60)).max(12) });
export const cartLine = z.object({
  menuItemId: objectId,
  quantity: z.number().int().min(1).max(20),
  selections: z.array(selection).max(12).default([]),
  note: z.string().trim().max(200).optional(),
});
const itemsBody = z.object({ items: z.array(cartLine).max(40) });

/** Cart lines with a display snapshot built from today's menu (prices are informational; checkout re-prices). */
async function describeCart(lines) {
  const ids = lines.map((l) => String(l.menuItem));
  const docs = ids.length ? await MenuItem.find({ _id: { $in: ids }, archived: false }).populate('optionGroups').populate('category', 'name').lean() : [];
  const byId = new Map(docs.map((d) => [String(d._id), d]));
  const items = [];
  for (const line of lines) {
    const item = byId.get(String(line.menuItem));
    if (!item) continue;
    const selections = (line.selections ?? []).map((s) => ({ group: s.group, choices: [...s.choices] }));
    const { line: priced } = priceLine(item, { quantity: line.quantity, selections, note: line.note });
    items.push({
      menuItemId: String(item._id),
      quantity: line.quantity,
      selections,
      note: line.note || undefined,
      snap: {
        name: item.name,
        slug: item.slug,
        unitPrice: priced.unitPrice,
        optionNames: priced.options.map((o) => o.choiceName),
        art: item.art?.motif ? { motif: item.art.motif, palette: item.art.palette, seed: item.art.seed } : undefined,
        image: item.images?.[0]?.url,
      },
    });
  }
  return { items };
}

router.get('/', requireAuth, async (req, res) => {
  const cart = await Cart.findOne({ user: req.user._id }).lean();
  ok(res, await describeCart(cart?.items ?? []));
});

router.put('/', requireAuth, validate({ body: itemsBody }), async (req, res) => {
  const lines = req.valid.body.items.map((l) => ({ menuItem: l.menuItemId, quantity: l.quantity, selections: l.selections, note: l.note }));
  const cart = await Cart.findOneAndUpdate({ user: req.user._id }, { $set: { items: lines } }, { upsert: true, new: true, setDefaultsOnInsert: true }).lean();
  ok(res, await describeCart(cart.items));
});

router.delete('/', requireAuth, async (req, res) => {
  await Cart.updateOne({ user: req.user._id }, { $set: { items: [] } });
  ok(res, { items: [] });
});

// Server-authoritative totals for the cart and checkout screens. Works for guests too.
const quoteBody = z.object({
  items: z.array(cartLine).max(40),
  fulfillment: z.enum(FULFILLMENT).default('delivery'),
  couponCode: z.string().trim().max(24).optional(),
  loyaltyPoints: z.number().int().min(0).max(1_000_000).optional(),
});
router.post('/quote', limiter({ windowMs: 60_000, limit: 90 }), validate({ body: quoteBody }), async (req, res) => {
  const quote = await buildQuote(req.valid.body, { userId: req.user ? String(req.user._id) : null });
  // Lines are returned for display; internal ids of option groups are not needed by the browser.
  ok(res, {
    ok: quote.ok,
    fulfillment: quote.fulfillment,
    lines: quote.lines.map((l) => ({ menuItemId: String(l.menuItem), name: l.name, quantity: l.quantity, unitPrice: l.unitPrice, lineTotal: l.lineTotal, options: l.options.map((o) => ({ groupName: o.groupName, choiceName: o.choiceName, priceDelta: o.priceDelta })) })),
    totals: quote.totals,
    coupon: quote.coupon ? { code: quote.coupon.code, description: quote.coupon.description, discount: quote.coupon.discount, freeDelivery: quote.coupon.freeDelivery } : null,
    loyalty: quote.loyalty,
    issues: quote.issues,
    warnings: quote.warnings,
    rules: quote.rules,
  });
});

export default router;
