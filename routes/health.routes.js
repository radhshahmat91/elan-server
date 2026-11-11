import { Router } from 'express';
import mongoose from 'mongoose';
import { ok } from '../utils/http.js';

export const basePath = '/health';

const router = Router();

// Liveness + database state. Used by Render/uptime monitors (hit it every few minutes to keep a free instance warm).
router.get('/', (_req, res) => {
  const states = ['disconnected', 'connected', 'connecting', 'disconnecting'];
  ok(res, {
    status: 'ok',
    service: 'elan-api',
    uptimeSeconds: Math.round(process.uptime()),
    database: states[mongoose.connection.readyState] ?? 'unknown',
    time: new Date().toISOString(),
  });
});

export default router;
