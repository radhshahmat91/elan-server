// Loads and validates environment variables once, at startup.
// Importing this file never connects to anything; it only parses process.env.
try {
  await import('dotenv/config');
} catch {
  // dotenv is optional (Node's --env-file also works); real env vars still apply.
}
import { z } from 'zod';

const optionalString = z
  .string()
  .optional()
  .transform((v) => (v && v.trim() !== '' ? v.trim() : undefined));

const schema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().positive().default(5000),
  MONGODB_URI: z.string().min(1).default('mongodb://127.0.0.1:27017/elan'),
  CLIENT_ORIGINS: z.string().default('http://localhost:3000'),
  PUBLIC_CLIENT_URL: z.string().url().default('http://localhost:3000'),
  TRUST_PROXY: z.coerce.number().int().min(0).max(5).default(1),

  SESSION_COOKIE_NAME: z.string().default('elan_session'),
  SESSION_TTL_DAYS: z.coerce.number().int().positive().max(365).default(30),
  COOKIE_SECURE: z.enum(['auto', 'true', 'false']).default('auto'),
  COOKIE_SAMESITE: z.enum(['lax', 'strict', 'none']).default('lax'),

  SOCKET_TOKEN_SECRET: z.string().min(16).default('dev-socket-secret-change-me-please-0001'),
  PAYMENT_WEBHOOK_SECRET: z.string().min(16).default('dev-webhook-secret-change-me-please-001'),

  RESTAURANT_TZ_OFFSET_MINUTES: z.coerce.number().int().min(-720).max(840).default(360),

  SMTP_HOST: optionalString,
  SMTP_PORT: z.coerce.number().int().positive().default(587),
  SMTP_SECURE: z.enum(['true', 'false']).default('false'),
  SMTP_USER: optionalString,
  SMTP_PASS: optionalString,
  EMAIL_FROM: z.string().default('ÉLAN <no-reply@elan.example>'),

  CLOUDINARY_CLOUD_NAME: optionalString,
  CLOUDINARY_API_KEY: optionalString,
  CLOUDINARY_API_SECRET: optionalString,

  ALLOW_DEMO_SEED: z.enum(['true', 'false']).default('false'),
  // A labelled demo deployment: password-reset links are shown on screen when no SMTP server is configured.
  DEMO_MODE: z.enum(['true', 'false']).default('false'),
  ADMIN_EMAIL: optionalString,
  ADMIN_PASSWORD: optionalString,
  ADMIN_NAME: z.string().default('Owner'),
});

const parsed = schema.safeParse(process.env);
if (!parsed.success) {
  const lines = parsed.error.issues.map((i) => `  - ${i.path.join('.')}: ${i.message}`);
  throw new Error(`Invalid environment configuration:\n${lines.join('\n')}`);
}

const raw = parsed.data;
const isProd = raw.NODE_ENV === 'production';

if (isProd) {
  const problems = [];
  if (!process.env.MONGODB_URI) problems.push('MONGODB_URI must be set in production.');
  if (raw.SOCKET_TOKEN_SECRET.startsWith('dev-')) problems.push('SOCKET_TOKEN_SECRET still has the development default.');
  if (raw.PAYMENT_WEBHOOK_SECRET.startsWith('dev-')) problems.push('PAYMENT_WEBHOOK_SECRET still has the development default.');
  if (raw.CLIENT_ORIGINS.includes('localhost')) problems.push('CLIENT_ORIGINS must list your deployed site, not localhost.');
  if (problems.length) throw new Error(`Unsafe production configuration:\n  - ${problems.join('\n  - ')}`);
}

const allowedOrigins = raw.CLIENT_ORIGINS.split(',')
  .map((o) => o.trim().replace(/\/+$/, ''))
  .filter(Boolean);

export const env = Object.freeze({
  ...raw,
  isProd,
  isTest: raw.NODE_ENV === 'test',
  allowedOrigins,
  smtpConfigured: Boolean(raw.SMTP_HOST),
  cloudinaryConfigured: Boolean(raw.CLOUDINARY_CLOUD_NAME && raw.CLOUDINARY_API_KEY && raw.CLOUDINARY_API_SECRET),
  allowDemoSeed: raw.ALLOW_DEMO_SEED === 'true',
  demoMode: raw.DEMO_MODE === 'true' || !isProd,
});
