import { Router } from 'express';
import { requirePermission } from '../middleware/auth.js';
import { dateKey, validate, z } from '../middleware/validate.js';
import { ok } from '../utils/http.js';
import { audit } from '../services/auditService.js';
import { exportOrdersCsv, getOverview, getToday } from '../services/analyticsService.js';

export const basePath = '/admin/analytics';
const router = Router();

const rangeQuery = z.object({ range: z.enum(['7d', '30d', '90d']).optional(), from: dateKey.optional(), to: dateKey.optional() });

router.get('/overview', requirePermission('analytics:read'), validate({ query: rangeQuery }), async (req, res) => {
  ok(res, await getOverview(req.valid.query));
});

router.get('/today', requirePermission('analytics:read'), async (_req, res) => {
  ok(res, await getToday());
});

router.get('/export.csv', requirePermission('analytics:read'), validate({ query: rangeQuery }), async (req, res) => {
  const { filename, content } = await exportOrdersCsv(req.valid.query);
  await audit(req, 'analytics.export', { type: 'report', id: filename }, `Exported ${filename}`);
  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
  res.setHeader('Cache-Control', 'private, no-store');
  res.send(content);
});

export default router;
