// A gallery tile is either an uploaded photograph or art the website draws itself, never both.

/**
 * Turns a validated admin form into a Mongo update that keeps that rule: choosing a drawn picture for a tile that used to
 * hold a photograph removes the photograph, because an empty `url` is dropped by validation and would otherwise leave the
 * old photo in place and the change would silently do nothing.
 */
export function galleryUpdateFor(valid) {
  const body = { ...valid };
  const drawn = Boolean(body.art?.scene || body.art?.motif);
  if (drawn && !body.url) {
    delete body.url;
    delete body.publicId;
    return { $set: body, $unset: { url: '', publicId: '' } };
  }
  return { $set: body };
}
