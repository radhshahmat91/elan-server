import { Router } from 'express';
import { objectId, validate, z } from '../middleware/validate.js';
import { notFound } from '../utils/errors.js';
import { ok } from '../utils/http.js';
import { forYou, pairingsFor, popularItems } from '../services/recommendationService.js';

export const basePath = '/recommendations';
const router = Router();

const limitQuery = z.object({ limit: z.coerce.number().int().min(1).max(12).default(8) });

router.get('/popular', validate({ query: limitQuery }), async (req, res) => {
  ok(res, await popularItems(req.valid.query.limit));
});

// Signed-in guests get picks shaped by their past orders; everyone else gets what sells.
router.get('/for-you', validate({ query: limitQuery }), async (req, res) => {
  ok(res, await forYou(req.user?._id, req.valid.query.limit));
});

router.get('/pairings/:itemId', validate({ params: z.object({ itemId: objectId }), query: z.object({ limit: z.coerce.number().int().min(1).max(8).default(4) }) }), async (req, res) => {
  const items = await pairingsFor(req.valid.params.itemId, req.valid.query.limit);
  if (!items) throw notFound('That dish is not on the menu.');
  ok(res, items);
});

export default router;
