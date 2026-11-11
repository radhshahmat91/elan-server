import express from 'express';
import helmet from 'helmet';
import cors from 'cors';
import { env } from './config/env.js';
import { requestContext } from './middleware/requestContext.js';
import { loadSession } from './middleware/auth.js';
import { originGuard } from './middleware/csrf.js';
import { limiter } from './middleware/rateLimit.js';
import { notFoundHandler, errorHandler } from './middleware/errorHandler.js';
import { mountRoutes } from './routes/index.js';
import { UPLOAD_DIR } from './services/uploadService.js';

export async function createApp() {
  const app = express();
  app.disable('x-powered-by');
  app.set('trust proxy', env.TRUST_PROXY);

  app.use(requestContext);
  app.use(helmet({ crossOriginResourcePolicy: { policy: 'cross-origin' } }));
  app.use(
    cors({
      origin(origin, callback) {
        // Same-origin or tool requests have no Origin header. Browsers must be on the allowlist.
        if (!origin || env.allowedOrigins.includes(origin.replace(/\/+$/, ''))) return callback(null, true);
        return callback(null, false);
      },
      credentials: true,
      methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
      allowedHeaders: ['Content-Type', 'X-Requested-With', 'Accept'],
      maxAge: 600,
    }),
  );

  // The raw body is kept for payment webhook signature checks.
  app.use(
    express.json({
      limit: '300kb',
      verify: (req, _res, buf) => {
        req.rawBody = buf;
      },
    }),
  );
  app.use(express.urlencoded({ extended: false, limit: '50kb' }));

  // Images uploaded without Cloudinary (development). Served as inert files: no listing, no sniffing, long cache.
  app.use(
    '/uploads',
    express.static(UPLOAD_DIR, {
      index: false,
      dotfiles: 'ignore',
      maxAge: '30d',
      immutable: true,
      setHeaders: (res) => res.setHeader('X-Content-Type-Options', 'nosniff'),
    }),
  );

  app.use('/api', limiter({ windowMs: 60_000, limit: 400 }));
  app.use('/api', loadSession);
  app.use('/api', originGuard);

  await mountRoutes(app);

  app.use(notFoundHandler);
  app.use(errorHandler);
  return app;
}
