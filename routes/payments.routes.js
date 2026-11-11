import { Router } from 'express';
import { limiter } from '../middleware/rateLimit.js';
import { validate, z } from '../middleware/validate.js';
import { badRequest } from '../utils/errors.js';
import { ok } from '../utils/http.js';
import { completeSandboxSession, getSandboxSession, handleProviderEvent } from '../services/paymentService.js';

export const basePath = '/payments';
const router = Router();

const sessionParams = z.object({ sessionId: z.string().trim().min(8).max(80).regex(/^[A-Za-z0-9_-]+$/) });

// What the sandbox checkout page shows. No personal data.
router.get('/sandbox/session/:sessionId', limiter({ windowMs: 60_000, limit: 60 }), validate({ params: sessionParams }), async (req, res) => {
  ok(res, await getSandboxSession(req.valid.params.sessionId));
});

// The sandbox "bank" buttons. The server signs the outcome and feeds it through the same verified path as a real webhook.
router.post(
  '/sandbox/session/:sessionId/complete',
  limiter({ windowMs: 60_000, limit: 20 }),
  validate({ params: sessionParams, body: z.object({ outcome: z.enum(['succeeded', 'failed', 'cancelled']) }) }),
  async (req, res) => {
    ok(res, await completeSandboxSession(req.valid.params.sessionId, req.valid.body.outcome));
  },
);

// A real gateway would call this URL. Exempt from the CSRF header rule (see middleware/csrf.js); authenticated by signature instead.
router.post('/webhook/sandbox', limiter({ windowMs: 60_000, limit: 120 }), async (req, res) => {
  const signature = req.get('x-elan-signature');
  if (!req.rawBody || !signature) throw badRequest('Missing body or signature.');
  const result = await handleProviderEvent({ provider: 'sandbox', rawBody: req.rawBody, signature });
  ok(res, { received: true, ...result, order: undefined });
});

export default router;
