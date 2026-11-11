import { z } from 'zod';
import { unprocessable } from '../utils/errors.js';

export { z };

/**
 * Validates req.body / req.query / req.params with Zod schemas. Parsed (and trimmed, coerced) values
 * land on req.valid.{body,query,params}; the raw req.query stays untouched (read-only in Express 5).
 *   router.post('/', validate({ body: schema }), (req, res) => { const input = req.valid.body; ... })
 */
export function validate({ body, query, params } = {}) {
  return (req, _res, next) => {
    const valid = {};
    const issues = [];
    for (const [key, schema, source] of [
      ['body', body, req.body],
      ['query', query, req.query],
      ['params', params, req.params],
    ]) {
      if (!schema) continue;
      const result = schema.safeParse(source ?? {});
      if (result.success) {
        valid[key] = result.data;
      } else {
        for (const issue of result.error.issues) {
          issues.push({ path: [key === 'body' ? null : key, ...issue.path].filter((p) => p !== null).join('.'), message: issue.message });
        }
      }
    }
    if (issues.length) return next(unprocessable('Some details need fixing.', issues));
    req.valid = valid;
    return next();
  };
}

// Reusable field schemas ---------------------------------------------------------------------

export const objectId = z.string().regex(/^[a-f\d]{24}$/i, 'Invalid id');
export const email = z.string().trim().toLowerCase().email('Enter a valid email address').max(160);
export const phone = z
  .string()
  .trim()
  .regex(/^[+]?[0-9\s-]{7,20}$/, 'Enter a valid phone number')
  .transform((v) => v.replace(/[\s-]/g, ''));
export const dateKey = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Use YYYY-MM-DD');
export const timeHm = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'Use HH:mm');
export const password = z
  .string()
  .min(8, 'Use at least 8 characters')
  .max(128, 'Use at most 128 characters')
  .refine((v) => /[A-Za-z]/.test(v) && /\d/.test(v), 'Include at least one letter and one number');
export const pagination = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
});
export const boolString = z.enum(['true', 'false']).transform((v) => v === 'true');
