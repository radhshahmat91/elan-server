// Audit trail for sensitive actions. Never throws: auditing must not break the action being audited.
import { AuditLog } from '../models/index.js';
import { logger } from '../utils/logger.js';

const SECRET_KEY = /pass|token|secret|card|cvv|authorization|cookie/i;

function scrub(value, depth = 0) {
  if (value == null || depth > 4) return value;
  if (Array.isArray(value)) return value.slice(0, 30).map((v) => scrub(v, depth + 1));
  if (typeof value === 'object') {
    if (value instanceof Date) return value;
    const out = {};
    for (const [key, v] of Object.entries(value)) out[key] = SECRET_KEY.test(key) ? '[hidden]' : scrub(v, depth + 1);
    return out;
  }
  return typeof value === 'string' ? value.slice(0, 300) : value;
}

/**
 * @param {object} actor an express req (uses req.user and req.ip) or { id, name, role }
 * @param {string} action e.g. 'menu.update', 'order.status', 'staff.role'
 * @param {{type?:string,id?:any}} entity
 * @param {string} summary human readable, no secrets
 * @param {object} [meta] before/after values
 */
export async function audit(actor, action, entity = {}, summary = '', meta) {
  try {
    const who = actor?.user
      ? { id: actor.user._id, name: actor.user.name, role: actor.user.role }
      : actor && (actor.id || actor.name)
        ? { id: actor.id, name: actor.name, role: actor.role }
        : { name: 'System', role: 'system' };
    await AuditLog.create({
      actor: who,
      action,
      entity: { type: entity.type, id: entity.id != null ? String(entity.id) : undefined },
      summary: String(summary).slice(0, 300),
      meta: scrub(meta),
      ip: actor?.ip,
    });
  } catch (err) {
    logger.warn('audit write failed', { action, message: err.message });
  }
}
