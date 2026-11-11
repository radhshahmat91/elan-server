import { Router } from 'express';
import { limiter } from '../middleware/rateLimit.js';
import { validate, z } from '../middleware/validate.js';
import { ok } from '../utils/http.js';
import { answer } from '../services/conciergeService.js';

export const basePath = '/concierge';
const router = Router();

router.post(
  '/',
  limiter({ windowMs: 60_000, limit: 30, message: 'You are asking very quickly. Please give it a moment.' }),
  validate({ body: z.object({ message: z.string().trim().min(1, 'Type a question').max(300), locale: z.enum(['en', 'bn']).default('en') }) }),
  async (req, res) => {
    ok(res, await answer(req.valid.body.message, req.valid.body.locale));
  },
);

export default router;
