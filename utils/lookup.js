// Small lookup helpers shared by routes.
export const isObjectId = (value) => typeof value === 'string' && /^[a-f\d]{24}$/i.test(value);

/** Finds a document by Mongo id or by its unguessable publicId, whichever the caller holds. */
export function byIdOrPublicId(ref) {
  return isObjectId(ref) ? { _id: ref } : { publicId: String(ref) };
}

/** Builds a $set object from the keys a partial update actually supplied. */
export function pickDefined(source, keys) {
  const out = {};
  for (const key of keys) if (source[key] !== undefined) out[key] = source[key];
  return out;
}

/** Empty strings from forms mean "clear this optional text". */
export const blankToNull = (value) => (value === '' ? null : value);
