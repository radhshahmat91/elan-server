import assert from 'node:assert/strict';
import test from 'node:test';
import { galleryUpdateFor } from '../utils/gallery.js';

test('choosing a drawn picture removes the old photograph', () => {
  const update = galleryUpdateFor({ title: 'The room', art: { scene: 'dining-room' } });
  assert.deepEqual(update.$unset, { url: '', publicId: '' });
  assert.equal('url' in update.$set, false);
  assert.equal('publicId' in update.$set, false);
  assert.deepEqual(update.$set.art, { scene: 'dining-room' });
});

test('a motif counts as a drawn picture too', () => {
  const update = galleryUpdateFor({ art: { motif: 'rings' } });
  assert.deepEqual(update.$unset, { url: '', publicId: '' });
});

test('choosing a photograph keeps it and clears the art', () => {
  const update = galleryUpdateFor({ url: '/uploads/room.jpg', art: {} });
  assert.equal(update.$unset, undefined);
  assert.equal(update.$set.url, '/uploads/room.jpg');
  assert.deepEqual(update.$set.art, {});
});

test('a change that does not touch the picture leaves it alone', () => {
  const update = galleryUpdateFor({ active: false });
  assert.deepEqual(update, { $set: { active: false } });
});

test('it never mutates the validated input', () => {
  const input = Object.freeze({ title: 'Bar', art: Object.freeze({ scene: 'bar' }) });
  assert.doesNotThrow(() => galleryUpdateFor(input));
});
