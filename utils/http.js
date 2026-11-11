// Response and query helpers shared by every route.

/** Success envelope: { ok: true, data, meta? } */
export function ok(res, data = null, meta, status = 200) {
  const body = { ok: true, data };
  if (meta) body.meta = meta;
  return res.status(status).json(body);
}

export function created(res, data, meta) {
  return ok(res, data, meta, 201);
}

/** Reads ?page and ?pageSize with sane bounds. */
export function parsePagination(query = {}, { defaultSize = 20, maxSize = 100 } = {}) {
  const page = Math.max(1, parseInt(query.page, 10) || 1);
  const pageSize = Math.min(maxSize, Math.max(1, parseInt(query.pageSize, 10) || defaultSize));
  return { page, pageSize, skip: (page - 1) * pageSize, limit: pageSize };
}

export function pageMeta({ page, pageSize }, total) {
  return { page, pageSize, total, totalPages: Math.max(1, Math.ceil(total / pageSize)) };
}

/** Escapes user text before it goes into a RegExp (search boxes). */
export function escapeRegex(text) {
  return String(text).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** Case-insensitive "contains" regex for search queries. */
export function containsRegex(text) {
  return new RegExp(escapeRegex(String(text).trim()), 'i');
}
